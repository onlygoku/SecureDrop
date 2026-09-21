from __future__ import annotations

import os
import queue
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from securedrop.crypto import AuthenticationError, SecureDropError, decrypt, encrypt

try:
    from tkinterdnd2 import DND_FILES, TkinterDnD
    RootWindow = TkinterDnD.Tk
except ImportError:  # The app remains usable when optional drag/drop integration is unavailable.
    DND_FILES = None
    RootWindow = tk.Tk

APP_NAME = "SecureDrop"


class SecureDropApp(RootWindow):
    def __init__(self):
        super().__init__()
        self.title(APP_NAME)
        self.minsize(660, 570)
        self.geometry("760x640")
        self.files: list[Path] = []
        self.mode = tk.StringVar(value="encrypt")
        self.status = tk.StringVar(value="No files selected.")
        self.output = tk.StringVar()
        self.show_password = tk.BooleanVar(value=False)
        self.events: queue.Queue = queue.Queue()
        self._configure_style()
        self._menu()
        self._build()
        self.after(80, self._poll_events)
        if len(sys.argv) > 1 and sys.argv[1].lower().endswith(".sdrop"):
            self.set_decrypt(Path(sys.argv[1]))

    def _configure_style(self):
        style = ttk.Style(self)
        style.theme_use("vista" if "vista" in style.theme_names() else "clam")
        style.configure("Title.TLabel", font=("Segoe UI", 12, "bold"))
        style.configure("Small.TLabel", font=("Segoe UI", 9), foreground="#555555")
        style.configure("Drop.TFrame", relief="solid", borderwidth=1)
        style.configure("Drop.TLabel", font=("Segoe UI", 11))
        style.configure("TButton", padding=(10, 5))

    def _menu(self):
        menu = tk.Menu(self)
        file_menu = tk.Menu(menu, tearoff=False)
        file_menu.add_command(label="Encrypt files", accelerator="Ctrl+E", command=self.choose_encrypt)
        file_menu.add_command(label="Decrypt package", accelerator="Ctrl+D", command=self.choose_decrypt)
        file_menu.add_separator(); file_menu.add_command(label="Exit", command=self.destroy)
        tools = tk.Menu(menu, tearoff=False); tools.add_command(label="Settings", command=self.settings)
        help_menu = tk.Menu(menu, tearoff=False); help_menu.add_command(label="Security information", command=self.security_info); help_menu.add_command(label="About SecureDrop", command=self.about)
        menu.add_cascade(label="File", menu=file_menu); menu.add_cascade(label="Tools", menu=tools); menu.add_cascade(label="Help", menu=help_menu)
        self.config(menu=menu); self.bind_all("<Control-e>", lambda _: self.choose_encrypt()); self.bind_all("<Control-d>", lambda _: self.choose_decrypt())

    def _build(self):
        root = ttk.Frame(self, padding=18); root.grid(sticky="nsew")
        self.columnconfigure(0, weight=1); self.rowconfigure(0, weight=1); root.columnconfigure(0, weight=1); root.rowconfigure(3, weight=1)
        ttk.Label(root, text="File", style="Title.TLabel").grid(row=0, column=0, sticky="w")
        self.action_label = ttk.Label(root, text="Encrypt files")
        self.action_label.grid(row=1, column=0, sticky="w", pady=(13, 6))
        self.drop = ttk.Frame(root, style="Drop.TFrame", padding=26); self.drop.grid(row=2, column=0, sticky="ew")
        self.drop.columnconfigure(0, weight=1)
        self.drop_text = ttk.Label(self.drop, text="Drop files or folders here", style="Drop.TLabel", anchor="center")
        self.drop_text.grid(row=0, column=0, sticky="ew")
        self.drop_hint = ttk.Label(self.drop, text="Files and folders are supported. Click to select.", style="Small.TLabel", anchor="center")
        self.drop_hint.grid(row=1, column=0, sticky="ew", pady=(5, 0))
        for widget in (self.drop, self.drop_text, self.drop_hint): widget.bind("<Button-1>", lambda _: self.choose_encrypt() if self.mode.get() == "encrypt" else self.choose_decrypt())
        if DND_FILES:
            self.drop.drop_target_register(DND_FILES)
            self.drop.dnd_bind("<<Drop>>", self.drop_files)
        self.tree = ttk.Treeview(root, columns=("kind", "size"), show="tree headings", height=7)
        self.tree.heading("#0", text="Selected files"); self.tree.heading("kind", text="Type"); self.tree.heading("size", text="Size")
        self.tree.column("#0", width=410); self.tree.column("kind", width=100); self.tree.column("size", width=100, anchor="e")
        self.tree.grid(row=3, column=0, sticky="nsew", pady=(14, 0))
        ttk.Label(root, textvariable=self.status, style="Small.TLabel").grid(row=4, column=0, sticky="w", pady=(5, 14))
        form = ttk.Frame(root); form.grid(row=5, column=0, sticky="ew"); form.columnconfigure(1, weight=1)
        ttk.Label(form, text="Output").grid(row=0, column=0, sticky="w", padx=(0, 12))
        ttk.Entry(form, textvariable=self.output).grid(row=0, column=1, sticky="ew")
        ttk.Button(form, text="Browse", command=self.choose_output).grid(row=0, column=2, padx=(7, 0))
        ttk.Label(form, text="Password").grid(row=1, column=0, sticky="w", pady=(11, 0))
        self.password = ttk.Entry(form, show="•"); self.password.grid(row=1, column=1, sticky="ew", pady=(11, 0))
        ttk.Checkbutton(form, text="Show", variable=self.show_password, command=self.toggle_password).grid(row=1, column=2, sticky="w", padx=(7, 0), pady=(11, 0))
        self.confirm_label = ttk.Label(form, text="Confirm password"); self.confirm_label.grid(row=2, column=0, sticky="w", pady=(8, 0))
        self.confirm = ttk.Entry(form, show="•"); self.confirm.grid(row=2, column=1, sticky="ew", pady=(8, 0))
        self.detail = ttk.Label(root, text="Encryption: AES-256-GCM    Password derivation: Argon2id    Local operation only.", style="Small.TLabel")
        self.detail.grid(row=6, column=0, sticky="w", pady=(14, 7))
        self.progress = ttk.Progressbar(root, mode="determinate"); self.progress.grid(row=7, column=0, sticky="ew")
        bottom = ttk.Frame(root); bottom.grid(row=8, column=0, sticky="ew", pady=(10, 0)); bottom.columnconfigure(0, weight=1)
        self.progress_text = ttk.Label(bottom, text="", style="Small.TLabel"); self.progress_text.grid(row=0, column=0, sticky="w")
        self.run_button = ttk.Button(bottom, text="Encrypt", command=self.run); self.run_button.grid(row=0, column=1)
        ttk.Separator(root).grid(row=9, column=0, sticky="ew", pady=(16, 8))
        ttk.Label(root, text="SecureDrop 0.1.0    Local encryption. No cloud. No account.", style="Small.TLabel").grid(row=10, column=0, sticky="w")

    def toggle_password(self):
        char = "" if self.show_password.get() else "•"; self.password.configure(show=char); self.confirm.configure(show=char)

    def choose_encrypt(self):
        chosen = filedialog.askopenfilenames(title="Select files to encrypt")
        if chosen: self.set_encrypt([Path(item) for item in chosen])

    def drop_files(self, event):
        paths = [Path(item) for item in self.tk.splitlist(event.data)]
        if self.mode.get() == "decrypt":
            packages = [item for item in paths if item.suffix.lower() == ".sdrop"]
            if packages: self.set_decrypt(packages[0])
        elif paths:
            self.set_encrypt(paths)

    def choose_decrypt(self):
        chosen = filedialog.askopenfilename(title="Open SecureDrop package", filetypes=[("SecureDrop packages", "*.sdrop"), ("All files", "*.*")])
        if chosen: self.set_decrypt(Path(chosen))

    def set_encrypt(self, paths: list[Path]):
        self.mode.set("encrypt"); self.files = paths; self.action_label.config(text="Encrypt files"); self.drop_text.config(text="Drop files or folders here"); self.drop_hint.config(text="Files and folders are supported. Click to select.")
        self.confirm_label.grid(); self.confirm.grid(); self.run_button.config(text="Encrypt"); self.output.set(str(paths[0].with_suffix(".sdrop")) if len(paths) == 1 else str(Path.home() / "Documents" / "securedrop.sdrop")); self.populate()

    def set_decrypt(self, package: Path):
        self.mode.set("decrypt"); self.files = [package]; self.action_label.config(text="Decrypt package"); self.drop_text.config(text="Drop a .sdrop package here"); self.drop_hint.config(text="Or click to choose a package.")
        self.confirm_label.grid_remove(); self.confirm.grid_remove(); self.run_button.config(text="Decrypt"); self.output.set(str(package.with_suffix(""))); self.populate()

    def populate(self):
        self.tree.delete(*self.tree.get_children()); total = 0
        for path in self.files:
            size = self.folder_size(path) if path.is_dir() else path.stat().st_size
            total += size; self.tree.insert("", "end", text=path.name, values=("Folder" if path.is_dir() else "File", self.human_size(size)))
        self.status.set(f"{len(self.files)} item{'s' if len(self.files) != 1 else ''} selected    {self.human_size(total)}")

    @staticmethod
    def folder_size(path: Path) -> int:
        return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())
    @staticmethod
    def human_size(size: int) -> str:
        for unit in ("B", "KB", "MB", "GB", "TB"):
            if size < 1024 or unit == "TB": return f"{size:.1f} {unit}" if unit != "B" else f"{size} B"
            size /= 1024

    def choose_output(self):
        if self.mode.get() == "encrypt":
            path = filedialog.asksaveasfilename(title="Save encrypted package", defaultextension=".sdrop", filetypes=[("SecureDrop packages", "*.sdrop")])
        else: path = filedialog.askdirectory(title="Choose restore destination")
        if path: self.output.set(path)

    def run(self):
        if not self.files: return messagebox.showwarning(APP_NAME, "Select at least one file or package.")
        if not self.output.get().strip(): return messagebox.showwarning(APP_NAME, "Choose an output location.")
        password = self.password.get()
        if self.mode.get() == "encrypt" and password != self.confirm.get(): return messagebox.showwarning(APP_NAME, "The passwords do not match.")
        self.run_button.config(state="disabled"); self.progress["value"] = 0; self.progress_text.config(text="Preparing operation…")
        threading.Thread(target=self._work, args=(password,), daemon=True).start()

    def _work(self, password: str):
        def report(done, total): self.events.put(("progress", done, total))
        try:
            result = encrypt(self.files, self.output.get(), password, report) if self.mode.get() == "encrypt" else decrypt(self.files[0], self.output.get(), password, report)
            self.events.put(("success", result))
        except (SecureDropError, AuthenticationError) as error: self.events.put(("error", str(error)))
        except Exception as error: self.events.put(("error", f"Unexpected error: {error}"))

    def _poll_events(self):
        try:
            while True:
                event = self.events.get_nowait()
                if event[0] == "progress":
                    done, total = event[1:]; self.progress["value"] = (done / total * 100) if total else 0; self.progress_text.config(text=f"{self.human_size(done)} / {self.human_size(total)}")
                elif event[0] == "success":
                    self.run_button.config(state="normal"); self.progress["value"] = 100; self.progress_text.config(text="Operation completed."); messagebox.showinfo(APP_NAME, f"{'Encryption' if self.mode.get() == 'encrypt' else 'Decryption'} completed.\n\nOutput:\n{event[1]}")
                else:
                    self.run_button.config(state="normal"); self.progress_text.config(text="Operation failed."); messagebox.showerror(APP_NAME, f"Operation failed.\n\n{event[1]}")
        except queue.Empty: pass
        self.after(80, self._poll_events)

    def settings(self): messagebox.showinfo("Settings", "Settings are intentionally minimal in version 0.1.0.\n\nOutput locations are chosen per operation.")
    def security_info(self): messagebox.showinfo("Security information", "Packages use AES-256-GCM authenticated encryption.\nPasswords are derived with Argon2id.\n\nSecureDrop runs locally and does not transmit files or passwords.")
    def about(self): messagebox.showinfo("About SecureDrop", "SecureDrop\nLocal encrypted file packaging utility.\n\nVersion 0.1.0\nAES-256-GCM\nArgon2id\n\nNo account. No cloud. No telemetry.")


if __name__ == "__main__":
    SecureDropApp().mainloop()
