from __future__ import annotations

import sys
import time
import threading
from pathlib import Path

from PySide6.QtCore import (
    Qt,
    Signal,
    QObject,
    QPropertyAnimation,
    QEasingCurve,
    QSize,
)
from PySide6.QtGui import (
    QFont,
    QColor,
    QDragEnterEvent,
    QDropEvent,
)
from PySide6.QtWidgets import (
    QApplication,
    QMainWindow,
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QLineEdit,
    QFileDialog,
    QFrame,
    QProgressBar,
    QGraphicsDropShadowEffect,
    QStackedWidget,
    QCheckBox,
    QMessageBox,
)

from securedrop.crypto import (
    AuthenticationError,
    SecureDropError,
    encrypt,
    decrypt,
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
    "success": "#34C759",
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
    "success": "#30D158",
}


# ============================================================
# Helpers
# ============================================================

def human_size(size: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]

    value = float(size)

    for unit in units:
        if value < 1024:
            if unit == "B":
                return f"{int(value)} B"
            return f"{value:.1f} {unit}"

        value /= 1024

    return f"{value:.1f} PB"


def path_size(path: Path) -> int:
    if path.is_file():
        try:
            return path.stat().st_size
        except OSError:
            return 0

    total = 0

    try:
        for item in path.rglob("*"):
            try:
                if item.is_file():
                    total += item.stat().st_size
            except OSError:
                pass
    except OSError:
        pass

    return total


# ============================================================
# Worker signals
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

    def __init__(self, path: Path, theme):
        super().__init__()

        self.path = path
        self.theme = theme

        self.setObjectName("FileCard")

        layout = QHBoxLayout(self)
        layout.setContentsMargins(18, 14, 14, 14)
        layout.setSpacing(14)

        icon = QLabel("📁" if path.is_dir() else "📄")
        icon.setFixedSize(40, 40)
        icon.setAlignment(Qt.AlignmentFlag.AlignCenter)

        name_layout = QVBoxLayout()
        name_layout.setSpacing(2)

        name = QLabel(path.name)
        name.setObjectName("FileName")

        size = QLabel(
            "Folder" if path.is_dir()
            else human_size(path_size(path))
        )
        size.setObjectName("FileSize")

        name_layout.addWidget(name)
        name_layout.addWidget(size)

        remove = QPushButton("×")
        remove.setObjectName("RemoveButton")
        remove.setFixedSize(32, 32)
        remove.clicked.connect(
            lambda: self.remove_requested.emit(self)
        )

        layout.addWidget(icon)
        layout.addLayout(name_layout)
        layout.addStretch()
        layout.addWidget(remove)


# ============================================================
# Drop Zone
# ============================================================

class DropZone(QFrame):

    files_dropped = Signal(list)
    clicked = Signal()

    def __init__(self):
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

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit()

    def dragEnterEvent(self, event: QDragEnterEvent):
        if event.mimeData().hasUrls():
            self.setProperty("dragging", True)
            self.style().unpolish(self)
            self.style().polish(self)
            event.acceptProposedAction()

    def dragLeaveEvent(self, event):
        self.setProperty("dragging", False)
        self.style().unpolish(self)
        self.style().polish(self)

    def dropEvent(self, event: QDropEvent):

        paths = []

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

    def __init__(self):

        super().__init__()

        self.dark_mode = False
        self.theme = LIGHT

        self.files: list[Path] = []

        self.mode = "encrypt"

        self.worker_thread = None
        self.cancel_event = threading.Event()

        self.setWindowTitle("SecureDrop")
        self.setMinimumSize(760, 700)
        self.resize(900, 780)

        self.build_ui()
        self.apply_theme()

    # --------------------------------------------------------
    # UI
    # --------------------------------------------------------

    def build_ui(self):

        central = QWidget()
        self.setCentralWidget(central)

        root = QVBoxLayout(central)
        root.setContentsMargins(42, 36, 42, 30)
        root.setSpacing(0)

        # Header
        header = QHBoxLayout()

        title_layout = QVBoxLayout()
        title_layout.setSpacing(4)

        title = QLabel("SecureDrop")
        title.setObjectName("AppTitle")

        subtitle = QLabel(
            "Private file encryption."
        )
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

        # Segmented control
        segment = QHBoxLayout()
        segment.setSpacing(4)

        self.encrypt_button = QPushButton("Encrypt")
        self.decrypt_button = QPushButton("Decrypt")

        self.encrypt_button.setCheckable(True)
        self.decrypt_button.setCheckable(True)

        self.encrypt_button.setChecked(True)

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

        root.addWidget(segment_frame, alignment=Qt.AlignmentFlag.AlignLeft)

        root.addSpacing(24)

        # Drop zone
        self.drop_zone = DropZone()

        self.drop_zone.clicked.connect(
            self.choose_files
        )

        self.drop_zone.files_dropped.connect(
            self.add_files
        )

        root.addWidget(self.drop_zone)

        root.addSpacing(20)

        # Files container
        self.files_container = QFrame()
        self.files_container.setObjectName("FilesContainer")

        self.files_layout = QVBoxLayout(
            self.files_container
        )

        self.files_layout.setContentsMargins(
            10, 10, 10, 10
        )

        self.files_layout.setSpacing(8)

        root.addWidget(self.files_container)

        # Password section
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

        # Confirm password
        self.confirm = QLineEdit()
        self.confirm.setPlaceholderText(
            "Confirm password"
        )
        self.confirm.setEchoMode(
            QLineEdit.EchoMode.Password
        )

        root.addSpacing(10)

        root.addWidget(self.confirm)

        # Progress
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

        # Bottom bar
        root.addSpacing(20)

        bottom = QHBoxLayout()

        self.status = QLabel(
            "No files selected"
        )
        self.status.setObjectName("Status")

        self.clear_button = QPushButton("Clear")
        self.clear_button.setObjectName("SecondaryButton")
        self.clear_button.clicked.connect(
            self.clear_files
        )

        self.run_button = QPushButton("Encrypt")
        self.run_button.setObjectName("PrimaryButton")
        self.run_button.clicked.connect(
            self.run_operation
        )

        bottom.addWidget(self.status)
        bottom.addStretch()
        bottom.addWidget(self.clear_button)
        bottom.addWidget(self.run_button)

        root.addLayout(bottom)

        # Footer
        root.addSpacing(22)

        footer = QLabel(
            "AES-256-GCM  •  Argon2id  •  Local-only  •  No account"
        )
        footer.setObjectName("Footer")

        root.addWidget(
            footer,
            alignment=Qt.AlignmentFlag.AlignCenter
        )

    # --------------------------------------------------------
    # Theme
    # --------------------------------------------------------

    def apply_theme(self):

        t = self.theme

        self.setStyleSheet(f"""

        QWidget {{
            background: {t["background"]};
            color: {t["text"]};
            font-family: "Zinc";
        }}

        QLabel#AppTitle {{
            font-size: 32px;
            font-weight: 700;
            color: {t["text"]};
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
            opacity: 0.85;
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

        """)

    # --------------------------------------------------------
    # Theme toggle
    # --------------------------------------------------------

    def toggle_theme(self):

        self.dark_mode = not self.dark_mode

        self.theme = DARK if self.dark_mode else LIGHT

        self.theme_button.setText(
            "☾" if self.dark_mode else "☼"
        )

        self.apply_theme()

    # --------------------------------------------------------
    # Mode
    # --------------------------------------------------------

    def change_mode(self, mode):

        self.mode = mode

        self.encrypt_button.setChecked(
            mode == "encrypt"
        )

        self.decrypt_button.setChecked(
            mode == "decrypt"
        )

        self.files.clear()

        self.refresh_files()

        if mode == "encrypt":

            self.run_button.setText("Encrypt")

            self.confirm.show()

            self.drop_zone.title.setText(
                "Drop files here"
            )

            self.drop_zone.subtitle.setText(
                "or click to choose files from your computer"
            )

        else:

            self.run_button.setText("Decrypt")

            self.confirm.hide()

            self.drop_zone.title.setText(
                "Drop a .sdrop package here"
            )

            self.drop_zone.subtitle.setText(
                "or click to choose an encrypted package"
            )

    # --------------------------------------------------------
    # File selection
    # --------------------------------------------------------

    def choose_files(self):

        if self.mode == "encrypt":

            files, _ = QFileDialog.getOpenFileNames(
                self,
                "Choose files"
            )

            if files:
                self.add_files(
                    [Path(x) for x in files]
                )

        else:

            file, _ = QFileDialog.getOpenFileName(
                self,
                "Open SecureDrop package",
                "",
                "SecureDrop Package (*.sdrop)"
            )

            if file:
                self.add_files(
                    [Path(file)]
                )

    def add_files(self, paths):

        if self.mode == "decrypt":

            packages = [
                p for p in paths
                if p.suffix.lower() == ".sdrop"
            ]

            if packages:
                self.files = [packages[0]]

        else:

            self.files.extend(paths)

        self.refresh_files()

    def refresh_files(self):

        while self.files_layout.count():

            item = self.files_layout.takeAt(0)

            widget = item.widget()

            if widget:
                widget.deleteLater()

        total = 0

        for path in self.files:

            total += path_size(path)

            card = FileCard(
                path,
                self.theme
            )

            card.remove_requested.connect(
                self.remove_card
            )

            self.files_layout.addWidget(card)

        if self.files:

            self.status.setText(
                f"{len(self.files)} "
                f"{'item' if len(self.files) == 1 else 'items'}"
                f"  •  {human_size(total)}"
            )

        else:

            self.status.setText(
                "No files selected"
            )

    def remove_card(self, card):

        if card.path in self.files:

            self.files.remove(card.path)

        self.refresh_files()

    def clear_files(self):

        self.files.clear()

        self.refresh_files()

    # --------------------------------------------------------
    # Password
    # --------------------------------------------------------

    def toggle_password(self):

        visible = (
            self.show_password.isChecked()
        )

        mode = (
            QLineEdit.EchoMode.Normal
            if visible
            else QLineEdit.EchoMode.Password
        )

        self.password.setEchoMode(mode)
        self.confirm.setEchoMode(mode)

    def update_strength(self, password):

        length = len(password)

        if not password:

            self.strength.setText("")

        elif length < 8:

            self.strength.setText(
                "Weak · use at least 8 characters"
            )

        elif length < 12:

            self.strength.setText(
                "Okay · a longer passphrase is better"
            )

        else:

            self.strength.setText(
                "Strong"
            )

    # --------------------------------------------------------
    # Operation
    # --------------------------------------------------------

    def run_operation(self):

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

        if self.mode == "encrypt":

            if password != self.confirm.text():

                self.warning(
                    "The passwords do not match."
                )

                return

        # Output
        if self.mode == "encrypt":

            source = self.files[0]

            output, _ = QFileDialog.getSaveFileName(
                self,
                "Save encrypted package",
                str(
                    source.with_suffix(".sdrop")
                ),
                "SecureDrop Package (*.sdrop)"
            )

            if not output:
                return

        else:

            output = QFileDialog.getExistingDirectory(
                self,
                "Choose restore destination"
            )

            if not output:
                return

        self.start_operation(
            password,
            output
        )

    def start_operation(
        self,
        password,
        output
    ):

        self.cancel_event.clear()

        self.run_button.setDisabled(True)
        self.clear_button.setDisabled(True)

        self.progress.setValue(0)
        self.progress.show()

        self.progress_text.setText(
            "Preparing..."
        )

        self.progress_text.show()

        signals = WorkerSignals()

        signals.progress.connect(
            self.update_progress
        )

        signals.success.connect(
            self.operation_success
        )

        signals.error.connect(
            self.operation_error
        )

        def worker():

            try:

                def report(done, total):

                    if self.cancel_event.is_set():

                        raise SecureDropError(
                            "Operation cancelled."
                        )

                    signals.progress.emit(
                        done,
                        total
                    )

                if self.mode == "encrypt":

                    result = encrypt(
                        self.files,
                        output,
                        password,
                        report
                    )

                else:

                    result = decrypt(
                        self.files[0],
                        output,
                        password,
                        report
                    )

                signals.success.emit(
                    str(result)
                )

            except (
                SecureDropError,
                AuthenticationError
            ) as error:

                signals.error.emit(
                    str(error)
                )

            except Exception as error:

                signals.error.emit(
                    str(error)
                )

        self.worker_thread = threading.Thread(
            target=worker,
            daemon=True
        )

        self.worker_thread.start()

    # --------------------------------------------------------
    # Progress
    # --------------------------------------------------------

    def update_progress(
        self,
        done,
        total
    ):

        percent = (
            int(done / total * 100)
            if total
            else 0
        )

        self.progress.setValue(percent)

        self.progress_text.setText(
            f"{human_size(done)} / "
            f"{human_size(total)}  ·  "
            f"{percent}%"
        )

    # --------------------------------------------------------
    # Success
    # --------------------------------------------------------

    def operation_success(self, result):

        self.finish_operation()

        self.progress.setValue(100)

        self.progress_text.setText(
            "✓ Operation completed"
        )

        self.show_success(result)

    def show_success(self, result):

        box = QMessageBox(self)

        box.setWindowTitle(
            "SecureDrop"
        )

        box.setText(
            "Your files are secure."
        )

        box.setInformativeText(
            f"Output:\n{result}"
        )

        box.setStandardButtons(
            QMessageBox.StandardButton.Ok
        )

        box.exec()

    # --------------------------------------------------------
    # Error
    # --------------------------------------------------------

    def operation_error(self, error):

        self.finish_operation()

        self.progress.setValue(0)

        self.progress_text.setText(
            "Operation failed"
        )

        self.warning(error)

    def finish_operation(self):

        self.run_button.setDisabled(False)
        self.clear_button.setDisabled(False)

    # --------------------------------------------------------
    # Dialog
    # --------------------------------------------------------

    def warning(self, text):

        box = QMessageBox(self)

        box.setWindowTitle(
            "SecureDrop"
        )

        box.setIcon(
            QMessageBox.Icon.Warning
        )

        box.setText(text)

        box.exec()


# ============================================================
# Application
# ============================================================

def main():

    app = QApplication(sys.argv)

    app.setApplicationName(
        "SecureDrop"
    )

    app.setApplicationDisplayName(
        "SecureDrop"
    )

    app.setStyle("Fusion")

    font = QFont("Zinc")
    font.setHintingPreference(
        QFont.HintingPreference.PreferNoHinting
    )

    app.setFont(font)

    window = SecureDrop()

    window.show()

    sys.exit(
        app.exec()
    )


if __name__ == "__main__":
    main()