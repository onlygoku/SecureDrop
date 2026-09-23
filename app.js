const $ = (id) => document.getElementById(id);

const dropZone = $("dropZone");
const fileInput = $("fileInput");
const chooseFiles = $("chooseFiles");
const fileList = $("fileList");

const password = $("password");
const confirmPassword = $("confirmPassword");
const confirmField = $("confirmField");
const showPassword = $("showPassword");

const encryptMode = $("encryptMode");
const decryptMode = $("decryptMode");

const clearButton = $("clearButton");
const actionButton = $("actionButton");

const themeToggle = $("themeToggle");

const status = $("status");
const progressBar = $("progressBar");
const progressPercent = $("progressPercent");
const fileStatus = $("fileStatus");

let selectedFiles = [];
let currentMode = "encrypt";

const FORMAT = {
    magic: "SDRP",
    version: 1,
    cipher: "AES-256-GCM",
    kdf: "Argon2id",
    memory: 65536,
    iterations: 3,
    parallelism: 2,
    saltLength: 16,
    nonceLength: 12
};


/* =========================================================
   INITIAL STATE
========================================================= */

function updateUI() {
    const decrypt = currentMode === "decrypt";

    encryptMode.classList.toggle("active", !decrypt);
    decryptMode.classList.toggle("active", decrypt);

    actionButton.textContent = decrypt ? "Decrypt" : "Encrypt";

    confirmField.style.display = decrypt ? "none" : "block";

    renderFiles();
    updateFileStatus();
}

updateUI();


/* =========================================================
   THEME
========================================================= */

const savedTheme = localStorage.getItem("securedrop-theme");

if (savedTheme === "dark") {
    document.documentElement.dataset.theme = "dark";
    themeToggle.textContent = "☀";
}

themeToggle.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme === "dark";

    if (dark) {
        delete document.documentElement.dataset.theme;
        themeToggle.textContent = "☼";
        localStorage.setItem("securedrop-theme", "light");
    } else {
        document.documentElement.dataset.theme = "dark";
        themeToggle.textContent = "☀";
        localStorage.setItem("securedrop-theme", "dark");
    }
});


/* =========================================================
   MODE
========================================================= */

encryptMode.addEventListener("click", () => {
    currentMode = "encrypt";
    selectedFiles = [];
    password.value = "";
    confirmPassword.value = "";
    resetProgress();
    updateUI();
});

decryptMode.addEventListener("click", () => {
    currentMode = "decrypt";
    selectedFiles = [];
    password.value = "";
    confirmPassword.value = "";
    resetProgress();
    updateUI();
});


/* =========================================================
   FILE PICKER
========================================================= */

chooseFiles.addEventListener("click", (event) => {
    event.stopPropagation();
    fileInput.click();
});

dropZone.addEventListener("click", () => {
    fileInput.click();
});

fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
        addFiles(Array.from(fileInput.files));
    }

    fileInput.value = "";
});


/* =========================================================
   DRAG AND DROP
========================================================= */

["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();

        dropZone.classList.add("dragover");
    });
});

["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();

        dropZone.classList.remove("dragover");
    });
});

dropZone.addEventListener("drop", (event) => {
    const files = Array.from(event.dataTransfer.files);

    if (files.length > 0) {
        addFiles(files);
    }
});


/* =========================================================
   FILE MANAGEMENT
========================================================= */

function addFiles(files) {
    if (currentMode === "decrypt") {
        const sdropFiles = files.filter((file) =>
            file.name.toLowerCase().endsWith(".sdrop")
        );

        selectedFiles = sdropFiles;
    } else {
        selectedFiles = files;
    }

    renderFiles();
    updateFileStatus();
}

function renderFiles() {
    fileList.innerHTML = "";

    selectedFiles.forEach((file, index) => {
        const card = document.createElement("div");
        card.className = "file-card";

        card.innerHTML = `
            <div class="file-icon">+</div>

            <div class="file-info">
                <p class="file-name"></p>
                <p class="file-size"></p>
            </div>

            <button
                class="file-remove"
                type="button"
                aria-label="Remove file"
            >
                ×
            </button>
        `;

        card.querySelector(".file-name").textContent = file.name;
        card.querySelector(".file-size").textContent = formatBytes(file.size);

        card.querySelector(".file-remove").addEventListener("click", () => {
            selectedFiles.splice(index, 1);
            renderFiles();
            updateFileStatus();
        });

        fileList.appendChild(card);
    });
}

function updateFileStatus() {
    if (selectedFiles.length === 0) {
        fileStatus.textContent = "No files selected";
        return;
    }

    if (selectedFiles.length === 1) {
        fileStatus.textContent = selectedFiles[0].name;
        return;
    }

    fileStatus.textContent = `${selectedFiles.length} files selected`;
}

function formatBytes(bytes) {
    if (bytes === 0) return "0 B";

    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));

    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}


/* =========================================================
   PASSWORD
========================================================= */

showPassword.addEventListener("click", () => {
    const isPassword = password.type === "password";

    password.type = isPassword ? "text" : "password";
    confirmPassword.type = isPassword ? "text" : "password";

    showPassword.textContent = isPassword ? "Hide" : "Show";
});


/* =========================================================
   CLEAR
========================================================= */

clearButton.addEventListener("click", () => {
    selectedFiles = [];

    password.value = "";
    confirmPassword.value = "";

    resetProgress();

    renderFiles();
    updateFileStatus();

    setStatus("Ready");
});


/* =========================================================
   PROGRESS
========================================================= */

function setProgress(value, message) {
    const percentage = Math.max(0, Math.min(100, value));

    progressBar.style.width = `${percentage}%`;
    progressPercent.textContent = `${Math.round(percentage)}%`;

    if (message) {
        status.textContent = message;
    }
}

function resetProgress() {
    setProgress(0, "Ready");
}


/* =========================================================
   ACTION
========================================================= */

actionButton.addEventListener("click", async () => {
    if (currentMode === "encrypt") {
        await encryptFiles();
    } else {
        await decryptFiles();
    }
});


/* =========================================================
   ENCRYPT
========================================================= */

async function encryptFiles() {
    try {
        if (selectedFiles.length === 0) {
            setStatus("Choose a file first");
            return;
        }

        if (!password.value) {
            setStatus("Enter a password");
            password.focus();
            return;
        }

        if (password.value.length < 8) {
            setStatus("Password must be at least 8 characters");
            password.focus();
            return;
        }

        if (password.value !== confirmPassword.value) {
            setStatus("Passwords do not match");
            confirmPassword.focus();
            return;
        }

        if (!window.argon2) {
            throw new Error("Argon2 failed to load");
        }

        actionButton.disabled = true;
        clearButton.disabled = true;

        const file = selectedFiles[0];

        setProgress(5, "Reading file...");

        const plaintext = new Uint8Array(await file.arrayBuffer());

        setProgress(15, "Generating encryption parameters...");

        const salt = crypto.getRandomValues(
            new Uint8Array(FORMAT.saltLength)
        );

        const nonce = crypto.getRandomValues(
            new Uint8Array(FORMAT.nonceLength)
        );

        setProgress(25, "Deriving encryption key...");

        const keyBytes = await deriveKey(password.value, salt);

        setProgress(60, "Encrypting file...");

        const key = await crypto.subtle.importKey(
            "raw",
            keyBytes,
            {
                name: "AES-GCM"
            },
            false,
            ["encrypt"]
        );

        const header = {
            magic: FORMAT.magic,
            version: FORMAT.version,
            cipher: FORMAT.cipher,
            kdf: FORMAT.kdf,
            memory: FORMAT.memory,
            iterations: FORMAT.iterations,
            parallelism: FORMAT.parallelism,
            salt: bytesToBase64(salt),
            nonce: bytesToBase64(nonce),
            filename: file.name,
            size: file.size,
            mime: file.type || "application/octet-stream"
        };

        const headerBytes = new TextEncoder().encode(
            JSON.stringify(header)
        );

        const encrypted = await crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv: nonce,
                additionalData: headerBytes,
                tagLength: 128
            },
            key,
            plaintext
        );

        setProgress(85, "Building SecureDrop package...");

        const packageBytes = createPackage(
            headerBytes,
            new Uint8Array(encrypted)
        );

        const outputName =
            file.name.replace(/\.[^/.]+$/, "") + ".sdrop";

        downloadFile(
            packageBytes,
            outputName,
            "application/octet-stream"
        );

        setProgress(100, "Encryption complete");

        setStatus("SecureDrop package created");

    } catch (error) {
        console.error(error);

        setProgress(0, "Encryption failed");

        setStatus(
            error?.message || "Encryption failed"
        );

    } finally {
        actionButton.disabled = false;
        clearButton.disabled = false;
    }
}


/* =========================================================
   DECRYPT
========================================================= */

async function decryptFiles() {
    try {
        if (selectedFiles.length === 0) {
            setStatus("Choose a .sdrop file first");
            return;
        }

        if (!password.value) {
            setStatus("Enter the password");
            password.focus();
            return;
        }

        if (!window.argon2) {
            throw new Error("Argon2 failed to load");
        }

        actionButton.disabled = true;
        clearButton.disabled = true;

        const packageFile = selectedFiles[0];

        setProgress(5, "Reading SecureDrop package...");

        const packageBytes = new Uint8Array(
            await packageFile.arrayBuffer()
        );

        setProgress(20, "Reading package metadata...");

        const parsed = parsePackage(packageBytes);

        if (parsed.header.magic !== FORMAT.magic) {
            throw new Error("Invalid SecureDrop package");
        }

        if (parsed.header.version !== FORMAT.version) {
            throw new Error("Unsupported SecureDrop version");
        }

        if (parsed.header.kdf !== FORMAT.kdf) {
            throw new Error("Unsupported key derivation function");
        }

        if (parsed.header.cipher !== FORMAT.cipher) {
            throw new Error("Unsupported encryption algorithm");
        }

        const salt = base64ToBytes(parsed.header.salt);
        const nonce = base64ToBytes(parsed.header.nonce);

        setProgress(35, "Deriving encryption key...");

        const keyBytes = await deriveKey(
            password.value,
            salt
        );

        const key = await crypto.subtle.importKey(
            "raw",
            keyBytes,
            {
                name: "AES-GCM"
            },
            false,
            ["decrypt"]
        );

        setProgress(65, "Decrypting file...");

        const decrypted = await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: nonce,
                additionalData: parsed.headerBytes,
                tagLength: 128
            },
            key,
            parsed.ciphertext
        );

        setProgress(90, "Preparing decrypted file...");

        const filename =
            parsed.header.filename || "decrypted-file";

        downloadFile(
            new Uint8Array(decrypted),
            filename,
            parsed.header.mime || "application/octet-stream"
        );

        setProgress(100, "Decryption complete");

        setStatus("File decrypted successfully");

    } catch (error) {
        console.error(error);

        setProgress(0, "Decryption failed");

        if (
            error.name === "OperationError"
        ) {
            setStatus("Wrong password or corrupted package");
        } else {
            setStatus(
                error?.message || "Decryption failed"
            );
        }

    } finally {
        actionButton.disabled = false;
        clearButton.disabled = false;
    }
}


/* =========================================================
   ARGON2ID
========================================================= */

async function deriveKey(passphrase, salt) {
    const result = await window.argon2.hash({
        pass: passphrase,
        salt,
        time: FORMAT.iterations,
        mem: FORMAT.memory,
        parallelism: FORMAT.parallelism,
        hashLen: 32,
        type: window.argon2.ArgonType.Argon2id
    });

    return result.hash;
}


/* =========================================================
   PACKAGE FORMAT
=========================================================

   Layout:

   4 bytes  magic
   4 bytes  header length
   N bytes  JSON header
   remaining bytes ciphertext
========================================================= */

function createPackage(headerBytes, ciphertext) {
    const magic = new TextEncoder().encode("SDRP");

    const buffer = new ArrayBuffer(
        4 + 4 + headerBytes.length + ciphertext.length
    );

    const output = new Uint8Array(buffer);
    const view = new DataView(buffer);

    let offset = 0;

    output.set(magic, offset);
    offset += 4;

    view.setUint32(
        offset,
        headerBytes.length,
        false
    );

    offset += 4;

    output.set(headerBytes, offset);
    offset += headerBytes.length;

    output.set(ciphertext, offset);

    return output;
}

function parsePackage(bytes) {
    if (bytes.length < 8) {
        throw new Error("Invalid SecureDrop package");
    }

    const decoder = new TextDecoder();

    const magic = decoder.decode(
        bytes.slice(0, 4)
    );

    if (magic !== "SDRP") {
        throw new Error("Not a SecureDrop package");
    }

    const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength
    );

    const headerLength = view.getUint32(
        4,
        false
    );

    if (
        headerLength <= 0 ||
        headerLength > bytes.length - 8
    ) {
        throw new Error("Invalid package header");
    }

    const headerStart = 8;
    const headerEnd = headerStart + headerLength;

    const headerBytes = bytes.slice(
        headerStart,
        headerEnd
    );

    const ciphertext = bytes.slice(
        headerEnd
    );

    const decoderHeader = new TextDecoder();

    let header;

    try {
        header = JSON.parse(
            decoderHeader.decode(headerBytes)
        );
    } catch {
        throw new Error("Invalid package metadata");
    }

    return {
        header,
        headerBytes,
        ciphertext
    };
}


/* =========================================================
   DOWNLOAD
========================================================= */

function downloadFile(bytes, filename, mimeType) {
    const blob = new Blob(
        [bytes],
        {
            type: mimeType
        }
    );

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);

    link.click();

    link.remove();

    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 1000);
}


/* =========================================================
   BASE64
========================================================= */

function bytesToBase64(bytes) {
    let binary = "";

    const chunkSize = 0x8000;

    for (
        let i = 0;
        i < bytes.length;
        i += chunkSize
    ) {
        const chunk = bytes.subarray(
            i,
            i + chunkSize
        );

        binary += String.fromCharCode(
            ...chunk
        );
    }

    return btoa(binary);
}

function base64ToBytes(base64) {
    const binary = atob(base64);

    const bytes = new Uint8Array(
        binary.length
    );

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}


/* =========================================================
   STATUS
========================================================= */

function setStatus(message) {
    status.textContent = message;
}