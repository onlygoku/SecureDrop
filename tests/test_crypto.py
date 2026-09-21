from pathlib import Path
import pytest
from securedrop.crypto import AuthenticationError, decrypt, encrypt

def test_round_trip_files_and_folder(tmp_path: Path):
    source = tmp_path / "project"; source.mkdir()
    (source / "readme.txt").write_text("confidential")
    nested = source / "src"; nested.mkdir(); (nested / "app.py").write_text("print(1)")
    package = encrypt([source], tmp_path / "project.sdrop", "correct horse battery staple")
    target = tmp_path / "restored"
    decrypt(package, target, "correct horse battery staple")
    assert (target / "project" / "readme.txt").read_text() == "confidential"
    assert (target / "project" / "src" / "app.py").read_text() == "print(1)"

def test_wrong_password_rejected(tmp_path: Path):
    source = tmp_path / "note.txt"; source.write_text("secret")
    package = encrypt([source], tmp_path / "note.sdrop", "right")
    with pytest.raises(AuthenticationError): decrypt(package, tmp_path / "out", "wrong")
