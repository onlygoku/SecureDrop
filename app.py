from __future__ import annotations

import sys
import threading
import time
from pathlib import Path
from typing import Iterable

from PySide6.QtCore import Qt, QObject, Signal
from PySide6.QtGui import QDragEnterEvent, QDropEvent, QFont
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from securedrop.crypto import (
    AuthenticationError,
    SecureDropError,
    decrypt,
    encrypt,
)


# ============================================================
# Theme
# ============================================================

LIGHT = {
    "background": "#F5F5F7",
    "surface": "#FFFFFF",
    "surface2": "#F2F2F7",
    "text": "#1D1D1F",
    "secondary": "#86868B",
    "border": "#D2D2D7",
    "accent": "#0071E3",
    "accent_hover": "#0077ED",
    "danger": "#FF3B30",
}

DARK = {
    "background": "#000000",
    "surface": "#1C1C1E",
    "surface2": "#2C2C2E",
    "text": "#F5F5F7",
    "secondary": "#98989D",
    "border": "#38383A",
    "accent": "#0A84FF",
    "accent_hover": "#409CFF",
    "danger": "#FF453A",
}


# ============================================================
# Helpers
# ============================================================

def human_size(size: int) -> str:
    units = ("B", "KB", "MB", "GB", "TB")
    value = float(max(size, 0))

    for unit in units:
        if value < 1024:
            if unit == "B":
                return f"{int(value)} B"
            return f"{value:.1f} {unit}"

        value /= 1024

    return f"{value:.1f} PB"


def file_size(path: Path) -> int:
    """
    Return the size of a single file.

    Directories are not recursively scanned here because doing so
    can become expensive for large folders.
    """
    try:
        if path.is_file():
            return path.stat().st_size
    except OSError:
        pass

    return 0


def unique_paths(paths: Iterable[Path]) -> list[Path]:
    """
    Remove duplicate paths while preserving their order.
    """
    seen: set[Path] = set()
    result: list[Path] = []

    for path in paths:
        try:
            normalized = path.resolve()
        except OSError:
            normalized = path

        if normalized not in seen:
            seen.add(normalized)
            result.append(normalized)

    return result


# ============================================================
# Worker Signals
# ============================================================

class WorkerSignals(QObject):
    progress = Signal(int, int)
    success = Signal(str)
    error = Signal(str)


# ============================================================
# File Card
# ============================================================

class FileCard(QFrame):
    remove_requested = Signal(object)

    def __init__(self, path: Path) -> None:
        super().__init__()

        self.path = path
        self.setObjectName("FileCard")

        layout = QHBoxLayout(self)
        layout.setContentsMargins(18, 14, 14, 14)
        layout.setSpacing(14)

        icon = QLabel("📁" if path.is_dir() else "📄")
        icon.setFixedSize(40, 40)
        icon.setAlignment(Qt.AlignmentFlag.AlignCenter)

        name_layout = QVBoxLayout()
        name_layout.setSpacing(2)

        name = QLabel(path.name or str(path))
        name.setObjectName("FileName")

        size_label = QLabel(
            "Folder" if path.is_dir() else human_size(file_size(path))
        )
        size_label.setObjectName("FileSize")

        name_layout.addWidget(name)
        name_layout.addWidget(size_label)

        remove_button = QPushButton("×")
        remove_button.setObjectName("RemoveButton")
        remove_button.setFixedSize(32, 32)
        remove_button.clicked.connect(
            lambda: self.remove_requested.emit(self)
        )

        layout.addWidget(icon)
        layout.addLayout(name_layout)
        layout.addStretch()
        layout.addWidget(remove_button)


# ============================================================
# Drop Zone
# ============================================================

class DropZone(QFrame):
    files_dropped = Signal(list)
    clicked = Signal()

    def __init__(self) -> None:
        super().__init__()

        self.setAcceptDrops(True)
        self.setObjectName("DropZone")

        layout = QVBoxLayout(self)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.setSpacing(8)

        self.icon = QLabel("+")
        self.icon.setObjectName("DropIcon")
        self.icon.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self.title = QLabel("Drop files here")
        self.title.setObjectName("DropTitle")
        self.title.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self.subtitle = QLabel(
            "or click to choose files from your computer"
        )
        self.subtitle.setObjectName("DropSubtitle")
        self.subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)

        layout.addWidget(self.icon)
        layout.addWidget(self.title)
        layout.addWidget(self.subtitle)

    def mousePressEvent(self, event) -> None:
        if (
            event.button() == Qt.MouseButton.LeftButton
            and self.isEnabled()
        ):
            self.clicked.emit()

        super().mousePressEvent(event)

    def dragEnterEvent(self, event: QDragEnterEvent) -> None:
        if event.mimeData().hasUrls() and self.isEnabled():
            self.setProperty("dragging", True)
            self.style().unpolish(self)
            self.style().polish(self)
            event.acceptProposedAction()
        else:
            event.ignore()

    def dragLeaveEvent(self, event) -> None:
        self.setProperty("dragging", False)
        self.style().unpolish(self)
        self.style().polish(self)
        super().dragLeaveEvent(event)

    def dropEvent(self, event: QDropEvent) -> None:
        paths: list[Path] = []

        for url in event.mimeData().urls():
            if url.isLocalFile():
                paths.append(Path(url.toLocalFile()))

        if paths:
            self.files_dropped.emit(paths)

        self.setProperty("dragging", False)
        self.style().unpolish(self)
        self.style().polish(self)

        event.acceptProposedAction()


# ============================================================
# Main Window
# ============================================================

class SecureDrop(QMainWindow):

    def __init__(self) -> None:
        super().__init__()

        self.dark_mode = False
        self.theme = LIGHT

        self.files: list[Path] = []
        self.mode = "encrypt"

        self.worker_thread: threading.Thread | None = None
        self.cancel_event = threading.Event()
        self.operation_running = False

        self.setWindowTitle("SecureDrop")
        self.setMinimumSize(760, 700)
        self.resize(900, 780)

        self.build_ui()
        self.apply_theme()
        self.update_mode_ui()

    # ========================================================
    # UI
    # ========================================================

    def build_ui(self) -> None:
        central = QWidget()
        self.setCentralWidget(central)

        root = QVBoxLayout(central)
        root.setContentsMargins(42, 36, 42, 30)
        root.setSpacing(0)

        # ----------------------------------------------------
        # Header
        # ----------------------------------------------------

        header = QHBoxLayout()

        title_layout = QVBoxLayout()
        title_layout.setSpacing(4)

        title = QLabel("SecureDrop")
        title.setObjectName("AppTitle")

        subtitle = QLabel("Private file encryption.")
        subtitle.setObjectName("AppSubtitle")

        title_layout.addWidget(title)
        title_layout.addWidget(subtitle)

        header.addLayout(title_layout)
        header.addStretch()

        self.theme_button = QPushButton("☼")
        self.theme_button.setObjectName("IconButton")
        self.theme_button.setFixedSize(42, 42)
        self.theme_button.clicked.connect(self.toggle_theme)

        header.addWidget(self.theme_button)

        root.addLayout(header)
        root.addSpacing(30)

        # ----------------------------------------------------
        # Segmented Control
        # ----------------------------------------------------

        segment = QHBoxLayout()
        segment.setSpacing(4)

        self.encrypt_button = QPushButton("Encrypt")
        self.decrypt_button = QPushButton("Decrypt")

        self.encrypt_button.setCheckable(True)
        self.decrypt_button.setCheckable(True)

        self.encrypt_button.clicked.connect(
            lambda: self.change_mode("encrypt")
        )

        self.decrypt_button.clicked.connect(
            lambda: self.change_mode("decrypt")
        )

        segment.addWidget(self.encrypt_button)
        segment.addWidget(self.decrypt_button)

        segment_frame = QFrame()
        segment_frame.setObjectName("SegmentFrame")
        segment_frame.setLayout(segment)

        root.addWidget(
            segment_frame,
            alignment=Qt.AlignmentFlag.AlignLeft,
        )

        root.addSpacing(24)

        # ----------------------------------------------------
        # Drop Zone
        # ----------------------------------------------------

        self.drop_zone = DropZone()

        self.drop_zone.clicked.connect(self.choose_files)
        self.drop_zone.files_dropped.connect(self.add_files)

        root.addWidget(self.drop_zone)

        root.addSpacing(20)

        # ----------------------------------------------------
        # Files Container
        # ----------------------------------------------------

        self.files_container = QFrame()
        self.files_container.setObjectName("FilesContainer")

        self.files_layout = QVBoxLayout(self.files_container)
        self.files_layout.setContentsMargins(10, 10, 10, 10)
        self.files_layout.setSpacing(8)

        root.addWidget(self.files_container)

        # ----------------------------------------------------
        # Password
        # ----------------------------------------------------

        root.addSpacing(24)

        password_title = QLabel("Password")
        password_title.setObjectName("SectionTitle")

        root.addWidget(password_title)
        root.addSpacing(8)

        password_row = QHBoxLayout()
        password_row.setSpacing(8)

        self.password = QLineEdit()
        self.password.setPlaceholderText(
            "Enter a strong password"
        )
        self.password.setEchoMode(
            QLineEdit.EchoMode.Password
        )

        self.show_password = QCheckBox("Show")
        self.show_password.stateChanged.connect(
            self.toggle_password
        )

        password_row.addWidget(self.password)
        password_row.addWidget(self.show_password)

        root.addLayout(password_row)

        self.strength = QLabel("")
        self.strength.setObjectName("PasswordStrength")

        root.addWidget(self.strength)

        self.password.textChanged.connect(
            self.update_strength
        )

        # ----------------------------------------------------
        # Confirm Password
        # ----------------------------------------------------

        self.confirm = QLineEdit()
        self.confirm.setPlaceholderText("Confirm password")
        self.confirm.setEchoMode(
            QLineEdit.EchoMode.Password
        )

        root.addSpacing(10)
        root.addWidget(self.confirm)

        # ----------------------------------------------------
        # Progress
        # ----------------------------------------------------

        root.addSpacing(20)

        self.progress = QProgressBar()
        self.progress.setTextVisible(False)
        self.progress.setFixedHeight(5)
        self.progress.hide()

        root.addWidget(self.progress)

        self.progress_text = QLabel("")
        self.progress_text.setObjectName("ProgressText")
        self.progress_text.hide()

        root.addWidget(self.progress_text)

        # ----------------------------------------------------
        # Bottom Bar
        # ----------------------------------------------------

        root.addSpacing(20)

        bottom = QHBoxLayout()

        self.status = QLabel("No files selected")
        self.status.setObjectName("Status")

        self.clear_button = QPushButton("Clear")
        self.clear_button.setObjectName("SecondaryButton")
        self.clear_button.clicked.connect(self.clear_files)

        self.run_button = QPushButton("Encrypt")
        self.run_button.setObjectName("PrimaryButton")
        self.run_button.clicked.connect(self.run_operation)

        bottom.addWidget(self.status)
        bottom.addStretch()
        bottom.addWidget(self.clear_button)
        bottom.addWidget(self.run_button)

        root.addLayout(bottom)

        # ----------------------------------------------------
        # Footer
        # ----------------------------------------------------

        root.addSpacing(22)

        footer = QLabel(
            "AES-256-GCM  •  Argon2id  •  "
            "Local-only  •  No account"
        )
        footer.setObjectName("Footer")

        root.addWidget(
            footer,
            alignment=Qt.AlignmentFlag.AlignCenter,
        )

    # ========================================================
    # Theme
    # ========================================================

    def apply_theme(self) -> None:
        t = self.theme

        self.setStyleSheet(
            f"""
            QWidget {{
                background: {t["background"]};
                color: {t["text"]};
            }}

            QLabel#AppTitle {{
                font-size: 32px;
                font-weight: 700;
            }}

            QLabel#AppSubtitle {{
                font-size: 14px;
                color: {t["secondary"]};
            }}

            QLabel#SectionTitle {{
                font-size: 15px;
                font-weight: 600;
            }}

            QLabel#Status,
            QLabel#ProgressText,
            QLabel#Footer {{
                color: {t["secondary"]};
                font-size: 12px;
            }}

            QFrame#SegmentFrame {{
                background: {t["surface2"]};
                border-radius: 10px;
                padding: 3px;
            }}

            QFrame#SegmentFrame QPushButton {{
                background: transparent;
                border: none;
                border-radius: 8px;
                padding: 8px 24px;
                color: {t["secondary"]};
                font-size: 13px;
                font-weight: 600;
            }}

            QFrame#SegmentFrame QPushButton:checked {{
                background: {t["surface"]};
                color: {t["text"]};
            }}

            QFrame#DropZone {{
                background: {t["surface"]};
                border: 1px solid {t["border"]};
                border-radius: 18px;
                min-height: 180px;
            }}

            QFrame#DropZone[dragging="true"] {{
                border: 2px solid {t["accent"]};
                background: {t["surface2"]};
            }}

            QLabel#DropIcon {{
                font-size: 36px;
                color: {t["accent"]};
            }}

            QLabel#DropTitle {{
                font-size: 17px;
                font-weight: 600;
            }}

            QLabel#DropSubtitle {{
                font-size: 13px;
                color: {t["secondary"]};
            }}

            QFrame#FilesContainer {{
                background: transparent;
            }}

            QFrame#FileCard {{
                background: {t["surface"]};
                border: 1px solid {t["border"]};
                border-radius: 13px;
            }}

            QLabel#FileName {{
                font-size: 13px;
                font-weight: 600;
            }}

            QLabel#FileSize {{
                font-size: 12px;
                color: {t["secondary"]};
            }}

            QPushButton#RemoveButton {{
                background: {t["surface2"]};
                border: none;
                border-radius: 16px;
                font-size: 18px;
                color: {t["secondary"]};
            }}

            QPushButton#RemoveButton:hover {{
                color: {t["danger"]};
            }}

            QLineEdit {{
                background: {t["surface"]};
                border: 1px solid {t["border"]};
                border-radius: 11px;
                padding: 12px 14px;
                font-size: 14px;
                color: {t["text"]};
            }}

            QLineEdit:focus {{
                border: 2px solid {t["accent"]};
            }}

            QCheckBox {{
                color: {t["secondary"]};
                font-size: 13px;
            }}

            QLabel#PasswordStrength {{
                font-size: 12px;
                color: {t["secondary"]};
                padding-top: 4px;
            }}

            QPushButton#PrimaryButton {{
                background: {t["text"]};
                color: {t["background"]};
                border: none;
                border-radius: 11px;
                padding: 12px 26px;
                font-size: 14px;
                font-weight: 600;
                min-width: 110px;
            }}

            QPushButton#PrimaryButton:hover {{
                background: {t["accent"]};
            }}

            QPushButton#PrimaryButton:disabled {{
                background: {t["border"]};
                color: {t["secondary"]};
            }}

            QPushButton#SecondaryButton {{
                background: {t["surface2"]};
                color: {t["text"]};
                border: none;
                border-radius: 11px;
                padding: 12px 20px;
            }}

            QPushButton#SecondaryButton:hover {{
                background: {t["border"]};
            }}

            QPushButton#IconButton {{
                background: {t["surface"]};
                border: 1px solid {t["border"]};
                border-radius: 21px;
                font-size: 18px;
            }}

            QProgressBar {{
                background: {t["surface2"]};
                border: none;
                border-radius: 3px;
            }}

            QProgressBar::chunk {{
                background: {t["accent"]};
                border-radius: 3px;
            }}
            """
        )

    def toggle_theme(self) -> None:
        if self.operation_running:
            return

        self.dark_mode = not self.dark_mode
        self.theme = DARK if self.dark_mode else LIGHT

        self.theme_button.setText(
            "☾" if self.dark_mode else "☼"
        )

        self.apply_theme()

    # ========================================================
    # Mode
    # ========================================================

    def change_mode(self, mode: str) -> None:
        if self.operation_running:
            return

        if mode == self.mode:
            return

        self.mode = mode
        self.files.clear()

        self.refresh_files()
        self.update_mode_ui()

    def update_mode_ui(self) -> None:
        encrypting = self.mode == "encrypt"

        self.encrypt_button.setChecked(encrypting)
        self.decrypt_button.setChecked(not encrypting)

        self.run_button.setText(
            "Encrypt" if encrypting else "Decrypt"
        )

        self.confirm.setVisible(encrypting)

        if encrypting:
            self.drop_zone.title.setText(
                "Drop files here"
            )
            self.drop_zone.subtitle.setText(
                "or click to choose files from your computer"
            )
        else:
            self.drop_zone.title.setText(
                "Drop a .sdrop package here"
            )
            self.drop_zone.subtitle.setText(
                "or click to choose an encrypted package"
            )

    # ========================================================
    # File Selection
    # ========================================================

    def choose_files(self) -> None:
        if self.operation_running:
            return

        if self.mode == "encrypt":
            files, _ = QFileDialog.getOpenFileNames(
                self,
                "Choose files",
            )

            if files:
                self.add_files(
                    [Path(path) for path in files]
                )

            return

        file, _ = QFileDialog.getOpenFileName(
            self,
            "Open SecureDrop package",
            "",
            "SecureDrop Package (*.sdrop)",
        )

        if file:
            self.add_files([Path(file)])

    def add_files(self, paths: list[Path]) -> None:
        if self.operation_running:
            return

        valid_paths = [
            path
            for path in unique_paths(paths)
            if path.exists()
        ]

        if self.mode == "decrypt":
            packages = [
                path
                for path in valid_paths
                if path.is_file()
                and path.suffix.lower() == ".sdrop"
            ]

            self.files = packages[:1]

        else:
            self.files = unique_paths(
                [
                    *self.files,
                    *valid_paths,
                ]
            )

        self.refresh_files()

    def refresh_files(self) -> None:
        # Remove old cards.
        while self.files_layout.count():
            item = self.files_layout.takeAt(0)
            widget = item.widget()

            if widget is not None:
                widget.deleteLater()

        # Add current cards.
        for path in self.files:
            card = FileCard(path)

            card.remove_requested.connect(
                self.remove_card
            )

            card.setEnabled(
                not self.operation_running
            )

            self.files_layout.addWidget(card)

        # Update status.
        if not self.files:
            self.status.setText(
                "No files selected"
            )
            return

        total_size = sum(
            file_size(path)
            for path in self.files
            if path.is_file()
        )

        count = len(self.files)
        word = "item" if count == 1 else "items"

        folder_count = sum(
            1 for path in self.files if path.is_dir()
        )

        if folder_count:
            self.status.setText(
                f"{count} {word}  •  "
                f"{folder_count} folder(s)"
            )
        else:
            self.status.setText(
                f"{count} {word}  •  "
                f"{human_size(total_size)}"
            )

    def remove_card(self, card: FileCard) -> None:
        if self.operation_running:
            return

        try:
            self.files.remove(card.path)
        except ValueError:
            return

        self.refresh_files()

    def clear_files(self) -> None:
        if self.operation_running:
            return

        self.files.clear()
        self.refresh_files()

    # ========================================================
    # Password
    # ========================================================

    def toggle_password(self) -> None:
        visible = self.show_password.isChecked()

        echo_mode = (
            QLineEdit.EchoMode.Normal
            if visible
            else QLineEdit.EchoMode.Password
        )

        self.password.setEchoMode(echo_mode)
        self.confirm.setEchoMode(echo_mode)

    def update_strength(self, password: str) -> None:
        length = len(password)

        if not password:
            text = ""
        elif length < 8:
            text = "Weak · use at least 8 characters"
        elif length < 12:
            text = "Okay · a longer passphrase is better"
        else:
            text = "Strong"

        self.strength.setText(text)

    # ========================================================
    # Run Operation
    # ========================================================

    def run_operation(self) -> None:
        if self.operation_running:
            return

        if not self.files:
            self.warning(
                "Choose at least one file."
            )
            return

        password = self.password.text()

        if not password:
            self.warning(
                "Enter a password."
            )
            return

        if (
            self.mode == "encrypt"
            and password != self.confirm.text()
        ):
            self.warning(
                "The passwords do not match."
            )
            return

        # Snapshot all state before launching the worker.
        mode = self.mode
        selected_files = tuple(self.files)

        # ----------------------------------------------------
        # Select output
        # ----------------------------------------------------

        if mode == "encrypt":
            source = selected_files[0]

            output, _ = QFileDialog.getSaveFileName(
                self,
                "Save encrypted package",
                str(
                    source.with_suffix(".sdrop")
                ),
                "SecureDrop Package (*.sdrop)",
            )

        else:
            output = QFileDialog.getExistingDirectory(
                self,
                "Choose restore destination",
            )

        if not output:
            return

        self.start_operation(
            mode=mode,
            files=selected_files,
            password=password,
            output=output,
        )

    # ========================================================
    # Busy State
    # ========================================================

    def set_busy(self, busy: bool) -> None:
        self.operation_running = busy

        widgets = (
            self.encrypt_button,
            self.decrypt_button,
            self.clear_button,
            self.run_button,
            self.theme_button,
            self.password,
            self.confirm,
            self.show_password,
            self.drop_zone,
        )

        for widget in widgets:
            widget.setDisabled(busy)

    # ========================================================
    # Background Worker
    # ========================================================

    def start_operation(
        self,
        mode: str,
        files: tuple[Path, ...],
        password: str,
        output: str,
    ) -> None:

        self.cancel_event.clear()
        self.set_busy(True)

        self.progress.setValue(0)
        self.progress.show()

        self.progress_text.setText(
            "Preparing..."
        )
        self.progress_text.show()

        signals = WorkerSignals(self)

        signals.progress.connect(
            self.update_progress
        )

        signals.success.connect(
            self.operation_success
        )

        signals.error.connect(
            self.operation_error
        )

        def worker() -> None:
            try:
                last_percent = -1
                last_emit_time = 0.0

                def report(
                    done: int,
                    total: int,
                ) -> None:
                    nonlocal last_percent
                    nonlocal last_emit_time

                    if self.cancel_event.is_set():
                        raise SecureDropError(
                            "Operation cancelled."
                        )

                    now = time.monotonic()

                    percent = (
                        int(done / total * 100)
                        if total > 0
                        else 0
                    )

                    # Throttle UI updates.
                    # This prevents excessive Qt signal traffic.
                    should_emit = (
                        percent != last_percent
                        or now - last_emit_time >= 0.10
                    )

                    if should_emit:
                        last_percent = percent
                        last_emit_time = now

                        signals.progress.emit(
                            done,
                            total,
                        )

                # ------------------------------------------------
                # Encrypt
                # ------------------------------------------------

                if mode == "encrypt":
                    result = encrypt(
                        list(files),
                        output,
                        password,
                        report,
                    )

                # ------------------------------------------------
                # Decrypt
                # ------------------------------------------------

                else:
                    result = decrypt(
                        files[0],
                        output,
                        password,
                        report,
                    )

                if self.cancel_event.is_set():
                    raise SecureDropError(
                        "Operation cancelled."
                    )

                signals.success.emit(
                    str(result)
                )

            except (
                SecureDropError,
                AuthenticationError,
            ) as error:
                signals.error.emit(
                    str(error)
                )

            except Exception as error:
                signals.error.emit(
                    f"Unexpected error: {error}"
                )

        self.worker_thread = threading.Thread(
            target=worker,
            name="SecureDropWorker",
            daemon=True,
        )

        self.worker_thread.start()

    # ========================================================
    # Progress
    # ========================================================

    def update_progress(
        self,
        done: int,
        total: int,
    ) -> None:

        percent = (
            int(done / total * 100)
            if total > 0
            else 0
        )

        percent = min(
            max(percent, 0),
            100,
        )

        self.progress.setValue(percent)

        self.progress_text.setText(
            f"{human_size(done)} / "
            f"{human_size(total)}  ·  "
            f"{percent}%"
        )

    # ========================================================
    # Success
    # ========================================================

    def operation_success(
        self,
        result: str,
    ) -> None:

        mode = self.mode

        self.finish_operation()

        self.progress.setValue(100)
        self.progress_text.setText(
            "✓ Operation completed"
        )

        message = (
            "Encrypted package created."
            if mode == "encrypt"
            else "Files restored."
        )

        self.show_success(
            message,
            result,
        )

    def show_success(
        self,
        message: str,
        result: str,
    ) -> None:

        box = QMessageBox(self)

        box.setWindowTitle("SecureDrop")

        box.setIcon(
            QMessageBox.Icon.Information
        )

        box.setText(message)

        box.setInformativeText(
            f"Output:\n{result}"
        )

        box.setStandardButtons(
            QMessageBox.StandardButton.Ok
        )

        box.exec()

    # ========================================================
    # Error
    # ========================================================

    def operation_error(
        self,
        error: str,
    ) -> None:

        self.finish_operation()

        self.progress.setValue(0)
        self.progress_text.setText(
            "Operation failed"
        )

        self.warning(error)

    def finish_operation(self) -> None:
        self.set_busy(False)
        self.worker_thread = None

    # ========================================================
    # Dialog
    # ========================================================

    def warning(self, text: str) -> None:
        box = QMessageBox(self)

        box.setWindowTitle("SecureDrop")

        box.setIcon(
            QMessageBox.Icon.Warning
        )

        box.setText(text)

        box.setStandardButtons(
            QMessageBox.StandardButton.Ok
        )

        box.exec()


# ============================================================
# Application
# ============================================================

def main() -> None:
    app = QApplication(sys.argv)

    app.setApplicationName("SecureDrop")
    app.setApplicationDisplayName("SecureDrop")
    app.setStyle("Fusion")

    font = QFont()
    font.setHintingPreference(
        QFont.HintingPreference.PreferNoHinting
    )

    app.setFont(font)

    window = SecureDrop()
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()