const $ = (id) => document.getElementById(id);


/* =========================================================
   ELEMENTS
========================================================= */

const dropZone = $("dropZone");
const dropTitle = $("dropTitle");
const dropSubtitle = $("dropSubtitle");

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

const progressSection = $("progressSection");
const status = $("status");
const progressBar = $("progressBar");
const progressPercent = $("progressPercent");

const fileStatus = $("fileStatus");


/* =========================================================
   STATE
========================================================= */

let selectedFiles = [];
let currentMode = "encrypt";
let operationRunning = false;


/* =========================================================
   FORMAT
========================================================= */

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
    const decrypting = currentMode === "decrypt";

    encryptMode.classList.toggle(
        "active",
        !decrypting
    );

    decryptMode.classList.toggle(
        "active",
        decrypting
    );

    actionButton.textContent =
        decrypting ? "Decrypt" : "Encrypt";

    confirmField.style.display =
        decrypting ? "none" : "block";

    if (decrypting) {
        dropTitle.textContent =
            "Drop a .sdrop package here";

        dropSubtitle.textContent =
            "or click to choose an encrypted package";
    } else {
        dropTitle.textContent =
            "Drop files here";

        dropSubtitle.textContent =
            "or click to choose files from your device";
    }

    renderFiles();
    updateFileStatus();
}


/* =========================================================
   THEME
========================================================= */

const savedTheme =
    localStorage.getItem("securedrop-theme");

if (savedTheme === "dark") {
    document.documentElement.dataset.theme = "dark";
    themeToggle.textContent = "☀";
}


themeToggle.addEventListener(
    "click",
    () => {
        if (operationRunning) {
            return;
        }

        const dark =
            document.documentElement.dataset.theme === "dark";

        if (dark) {
            delete document.documentElement.dataset.theme;

            themeToggle.textContent = "☼";

            localStorage.setItem(
                "securedrop-theme",
                "light"
            );
        } else {
            document.documentElement.dataset.theme = "dark";

            themeToggle.textContent = "☀";

            localStorage.setItem(
                "securedrop-theme",
                "dark"
            );
        }
    }
);


/* =========================================================
   MODE
========================================================= */

encryptMode.addEventListener(
    "click",
    () => {
        if (operationRunning) {
            return;
        }

        currentMode = "encrypt";

        selectedFiles = [];

        password.value = "";
        confirmPassword.value = "";

        resetProgress();
        updateUI();
    }
);


decryptMode.addEventListener(
    "click",
    () => {
        if (operationRunning) {
            return;
        }

        currentMode = "decrypt";

        selectedFiles = [];

        password.value = "";
        confirmPassword.value = "";

        resetProgress();
        updateUI();
    }
);


/* =========================================================
   FILE PICKER
========================================================= */

chooseFiles.addEventListener(
    "click",
    (event) => {
        event.stopPropagation();

        if (operationRunning) {
            return;
        }

        fileInput.click();
    }
);


dropZone.addEventListener(
    "click",
    () => {
        if (operationRunning) {
            return;
        }

        fileInput.click();
    }
);


fileInput.addEventListener(
    "change",
    () => {
        if (operationRunning) {
            return;
        }

        const files =
            Array.from(fileInput.files);

        if (files.length > 0) {
            addFiles(files);
        }

        /*
         * Reset the input so selecting the same file
         * again still triggers the change event.
         */
        fileInput.value = "";
    }
);


/* =========================================================
   DRAG AND DROP
========================================================= */

["dragenter", "dragover"].forEach(
    (eventName) => {
        dropZone.addEventListener(
            eventName,
            (event) => {
                event.preventDefault();
                event.stopPropagation();

                if (operationRunning) {
                    return;
                }

                dropZone.classList.add("dragover");
            }
        );
    }
);


["dragleave", "drop"].forEach(
    (eventName) => {
        dropZone.addEventListener(
            eventName,
            (event) => {
                event.preventDefault();
                event.stopPropagation();

                dropZone.classList.remove("dragover");
            }
        );
    }
);


dropZone.addEventListener(
    "drop",
    (event) => {
        if (operationRunning) {
            return;
        }

        const files =
            Array.from(
                event.dataTransfer.files
            );

        if (files.length > 0) {
            addFiles(files);
        }
    }
);


/* =========================================================
   FILE MANAGEMENT
========================================================= */

function addFiles(files) {
    if (operationRunning) {
        return;
    }

    if (currentMode === "decrypt") {

        const sdropFiles =
            files.filter(
                (file) =>
                    file.name
                        .toLowerCase()
                        .endsWith(".sdrop")
            );

        selectedFiles =
            sdropFiles.slice(0, 1);

    } else {

        /*
         * The current package format creates one .sdrop
         * package from one source file.
         *
         * Therefore only the first file is accepted.
         */
        selectedFiles =
            files.slice(0, 1);
    }

    renderFiles();
    updateFileStatus();

    resetProgress();
}


function renderFiles() {
    /*
     * Build the entire list in memory first.
     * This reduces repeated DOM insertions.
     */
    const fragment =
        document.createDocumentFragment();

    for (
        let index = 0;
        index < selectedFiles.length;
        index++
    ) {
        const file =
            selectedFiles[index];

        const card =
            document.createElement("div");

        card.className = "file-card";

        const icon =
            document.createElement("div");

        icon.className = "file-icon";
        icon.textContent = "＋";

        const info =
            document.createElement("div");

        info.className = "file-info";

        const name =
            document.createElement("p");

        name.className = "file-name";
        name.textContent = file.name;

        const size =
            document.createElement("p");

        size.className = "file-size";
        size.textContent =
            formatBytes(file.size);

        info.appendChild(name);
        info.appendChild(size);

        const removeButton =
            document.createElement("button");

        removeButton.className = "file-remove";
        removeButton.type = "button";
        removeButton.setAttribute(
            "aria-label",
            `Remove ${file.name}`
        );

        removeButton.textContent = "×";

        removeButton.addEventListener(
            "click",
            () => {
                if (operationRunning) {
                    return;
                }

                selectedFiles.splice(
                    index,
                    1
                );

                renderFiles();
                updateFileStatus();
                resetProgress();
            }
        );

        card.appendChild(icon);
        card.appendChild(info);
        card.appendChild(removeButton);

        fragment.appendChild(card);
    }

    fileList.replaceChildren(fragment);
}


function updateFileStatus() {
    if (selectedFiles.length === 0) {
        fileStatus.textContent =
            "No files selected";

        return;
    }

    if (selectedFiles.length === 1) {
        fileStatus.textContent =
            selectedFiles[0].name;

        return;
    }

    fileStatus.textContent =
        `${selectedFiles.length} files selected`;
}


function formatBytes(bytes) {
    if (bytes === 0) {
        return "0 B";
    }

    const units = [
        "B",
        "KB",
        "MB",
        "GB",
        "TB"
    ];

    const i =
        Math.floor(
            Math.log(bytes) / Math.log(1024)
        );

    return `${(
        bytes / Math.pow(1024, i)
    ).toFixed(
        i === 0 ? 0 : 1
    )} ${units[i]}`;
}


/* =========================================================
   PASSWORD
========================================================= */

showPassword.addEventListener(
    "click",
    () => {
        const isPassword =
            password.type === "password";

        password.type =
            isPassword ? "text" : "password";

        confirmPassword.type =
            isPassword ? "text" : "password";

        showPassword.textContent =
            isPassword ? "Hide" : "Show";
    }
);


/* =========================================================
   CLEAR
========================================================= */

clearButton.addEventListener(
    "click",
    () => {
        if (operationRunning) {
            return;
        }

        selectedFiles = [];

        password.value = "";
        confirmPassword.value = "";

        fileInput.value = "";

        renderFiles();
        updateFileStatus();

        resetProgress();
    }
);


/* =========================================================
   PROGRESS
========================================================= */

function setProgress(
    value,
    message = ""
) {
    const percentage =
        Math.max(
            0,
            Math.min(100, value)
        );

    /*
     * Only make the section visible when
     * setProgress is actually called.
     */
    progressSection.hidden = false;

    progressBar.style.width =
        `${percentage}%`;

    progressPercent.textContent =
        `${Math.round(percentage)}%`;

    if (message) {
        status.textContent = message;
    }
}


function resetProgress() {
    progressBar.style.width = "0%";
    progressPercent.textContent = "0%";
    status.textContent = "Ready";

    /*
     * Critical fix:
     * progress remains completely hidden
     * until an operation starts.
     */
    progressSection.hidden = true;
}


/* =========================================================
   BUSY STATE
========================================================= */

function setBusy(busy) {
    operationRunning = busy;

    encryptMode.disabled = busy;
    decryptMode.disabled = busy;

    chooseFiles.disabled = busy;
    clearButton.disabled = busy;
    actionButton.disabled = busy;

    password.disabled = busy;
    confirmPassword.disabled = busy;
    showPassword.disabled = busy;

    themeToggle.disabled = busy;

    dropZone.style.pointerEvents =
        busy ? "none" : "";
}


/* =========================================================
   ACTION
========================================================= */

actionButton.addEventListener(
    "click",
    async () => {
        if (operationRunning) {
            return;
        }

        if (currentMode === "encrypt") {
            await encryptFiles();
        } else {
            await decryptFiles();
        }
    }
);


/* =========================================================
   ENCRYPT
========================================================= */

async function encryptFiles() {
    if (operationRunning) {
        return;
    }

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
            setStatus(
                "Password must be at least 8 characters"
            );

            password.focus();
            return;
        }

        if (
            password.value !==
            confirmPassword.value
        ) {
            setStatus(
                "Passwords do not match"
            );

            confirmPassword.focus();
            return;
        }

        if (!window.argon2) {
            throw new Error(
                "Argon2 failed to load"
            );
        }

        setBusy(true);

        /*
         * Give the browser one rendering opportunity
         * before starting heavy work.
         */
        setProgress(
            0,
            "Preparing..."
        );

        await new Promise(
            (resolve) =>
                requestAnimationFrame(resolve)
        );

        const file =
            selectedFiles[0];

        setProgress(
            5,
            "Reading file..."
        );

        /*
         * Current architecture loads the complete
         * source file into memory.
         */
        const plaintext =
            new Uint8Array(
                await file.arrayBuffer()
            );

        setProgress(
            15,
            "Generating encryption parameters..."
        );

        const salt =
            crypto.getRandomValues(
                new Uint8Array(
                    FORMAT.saltLength
                )
            );

        const nonce =
            crypto.getRandomValues(
                new Uint8Array(
                    FORMAT.nonceLength
                )
            );

        setProgress(
            25,
            "Deriving encryption key..."
        );

        const keyBytes =
            await deriveKey(
                password.value,
                salt
            );

        setProgress(
            60,
            "Encrypting file..."
        );

        const key =
            await crypto.subtle.importKey(
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

            mime:
                file.type ||
                "application/octet-stream"
        };

        const headerBytes =
            new TextEncoder().encode(
                JSON.stringify(header)
            );

        const encrypted =
            await crypto.subtle.encrypt(
                {
                    name: "AES-GCM",
                    iv: nonce,
                    additionalData: headerBytes,
                    tagLength: 128
                },
                key,
                plaintext
            );

        setProgress(
            85,
            "Building SecureDrop package..."
        );

        const packageBytes =
            createPackage(
                headerBytes,
                new Uint8Array(encrypted)
            );

        const outputName =
            file.name.replace(
                /\.[^/.]+$/,
                ""
            ) + ".sdrop";

        downloadFile(
            packageBytes,
            outputName,
            "application/octet-stream"
        );

        setProgress(
            100,
            "Encryption complete"
        );

        setStatus(
            "SecureDrop package created"
        );

    } catch (error) {
        console.error(
            "Encryption error:",
            error
        );

        setProgress(
            0,
            "Encryption failed"
        );

        setStatus(
            error?.message ||
            "Encryption failed"
        );

    } finally {
        setBusy(false);
    }
}


/* =========================================================
   DECRYPT
========================================================= */

async function decryptFiles() {
    if (operationRunning) {
        return;
    }

    try {
        if (selectedFiles.length === 0) {
            setStatus(
                "Choose a .sdrop file first"
            );

            return;
        }

        if (!password.value) {
            setStatus(
                "Enter the password"
            );

            password.focus();
            return;
        }

        if (!window.argon2) {
            throw new Error(
                "Argon2 failed to load"
            );
        }

        setBusy(true);

        setProgress(
            0,
            "Preparing..."
        );

        await new Promise(
            (resolve) =>
                requestAnimationFrame(resolve)
        );

        const packageFile =
            selectedFiles[0];

        setProgress(
            5,
            "Reading SecureDrop package..."
        );

        const packageBytes =
            new Uint8Array(
                await packageFile.arrayBuffer()
            );

        setProgress(
            20,
            "Reading package metadata..."
        );

        const parsed =
            parsePackage(packageBytes);

        if (
            parsed.header.magic !==
            FORMAT.magic
        ) {
            throw new Error(
                "Invalid SecureDrop package"
            );
        }

        if (
            parsed.header.version !==
            FORMAT.version
        ) {
            throw new Error(
                "Unsupported SecureDrop version"
            );
        }

        if (
            parsed.header.kdf !==
            FORMAT.kdf
        ) {
            throw new Error(
                "Unsupported key derivation function"
            );
        }

        if (
            parsed.header.cipher !==
            FORMAT.cipher
        ) {
            throw new Error(
                "Unsupported encryption algorithm"
            );
        }

        const salt =
            base64ToBytes(
                parsed.header.salt
            );

        const nonce =
            base64ToBytes(
                parsed.header.nonce
            );

        setProgress(
            35,
            "Deriving encryption key..."
        );

        const keyBytes =
            await deriveKey(
                password.value,
                salt
            );

        const key =
            await crypto.subtle.importKey(
                "raw",
                keyBytes,
                {
                    name: "AES-GCM"
                },
                false,
                ["decrypt"]
            );

        setProgress(
            65,
            "Decrypting file..."
        );

        const decrypted =
            await crypto.subtle.decrypt(
                {
                    name: "AES-GCM",
                    iv: nonce,
                    additionalData:
                        parsed.headerBytes,
                    tagLength: 128
                },
                key,
                parsed.ciphertext
            );

        setProgress(
            90,
            "Preparing decrypted file..."
        );

        const filename =
            parsed.header.filename ||
            "decrypted-file";

        downloadFile(
            new Uint8Array(decrypted),
            filename,
            parsed.header.mime ||
                "application/octet-stream"
        );

        setProgress(
            100,
            "Decryption complete"
        );

        setStatus(
            "File decrypted successfully"
        );

    } catch (error) {
        console.error(
            "Decryption error:",
            error
        );

        setProgress(
            0,
            "Decryption failed"
        );

        if (
            error?.name ===
            "OperationError"
        ) {
            setStatus(
                "Wrong password or corrupted package"
            );
        } else {
            setStatus(
                error?.message ||
                "Decryption failed"
            );
        }

    } finally {
        setBusy(false);
    }
}


/* =========================================================
   ARGON2ID
========================================================= */

async function deriveKey(
    passphrase,
    salt
) {
    const result =
        await window.argon2.hash({
            pass: passphrase,
            salt: salt,

            time: FORMAT.iterations,
            mem: FORMAT.memory,
            parallelism: FORMAT.parallelism,

            hashLen: 32,

            type:
                window.argon2.ArgonType.Argon2id
        });

    return result.hash;
}


/* =========================================================
   PACKAGE FORMAT
=========================================================

   Layout:

   4 bytes   magic
   4 bytes   header length
   N bytes   JSON header
   remaining ciphertext

========================================================= */

function createPackage(
    headerBytes,
    ciphertext
) {
    const magic =
        new TextEncoder().encode("SDRP");

    const buffer =
        new ArrayBuffer(
            4 +
            4 +
            headerBytes.length +
            ciphertext.length
        );

    const output =
        new Uint8Array(buffer);

    const view =
        new DataView(buffer);

    let offset = 0;

    output.set(
        magic,
        offset
    );

    offset += 4;

    view.setUint32(
        offset,
        headerBytes.length,
        false
    );

    offset += 4;

    output.set(
        headerBytes,
        offset
    );

    offset +=
        headerBytes.length;

    output.set(
        ciphertext,
        offset
    );

    return output;
}


function parsePackage(bytes) {
    if (bytes.length < 8) {
        throw new Error(
            "Invalid SecureDrop package"
        );
    }

    const decoder =
        new TextDecoder();

    const magic =
        decoder.decode(
            bytes.slice(0, 4)
        );

    if (magic !== "SDRP") {
        throw new Error(
            "Not a SecureDrop package"
        );
    }

    const view =
        new DataView(
            bytes.buffer,
            bytes.byteOffset,
            bytes.byteLength
        );

    const headerLength =
        view.getUint32(
            4,
            false
        );

    if (
        headerLength <= 0 ||
        headerLength >
            bytes.length - 8
    ) {
        throw new Error(
            "Invalid package header"
        );
    }

    const headerStart = 8;

    const headerEnd =
        headerStart + headerLength;

    const headerBytes =
        bytes.slice(
            headerStart,
            headerEnd
        );

    const ciphertext =
        bytes.slice(headerEnd);

    const decoderHeader =
        new TextDecoder();

    let header;

    try {
        header =
            JSON.parse(
                decoderHeader.decode(
                    headerBytes
                )
            );
    } catch {
        throw new Error(
            "Invalid package metadata"
        );
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

function downloadFile(
    bytes,
    filename,
    mimeType
) {
    const blob =
        new Blob(
            [bytes],
            {
                type: mimeType
            }
        );

    const url =
        URL.createObjectURL(blob);

    const link =
        document.createElement("a");

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);

    link.click();

    link.remove();

    setTimeout(
        () => {
            URL.revokeObjectURL(url);
        },
        1000
    );
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
        const chunk =
            bytes.subarray(
                i,
                i + chunkSize
            );

        binary +=
            String.fromCharCode(
                ...chunk
            );
    }

    return btoa(binary);
}


function base64ToBytes(base64) {
    const binary =
        atob(base64);

    const bytes =
        new Uint8Array(
            binary.length
        );

    for (
        let i = 0;
        i < binary.length;
        i++
    ) {
        bytes[i] =
            binary.charCodeAt(i);
    }

    return bytes;
}


/* =========================================================
   STATUS
========================================================= */

function setStatus(message) {
    status.textContent = message;
}


/* =========================================================
   STARTUP
========================================================= */

/*
 * Important:
 * updateUI() builds the normal interface.
 * resetProgress() then guarantees that the progress
 * section starts hidden instead of showing "Preparing...".
 */

updateUI();
resetProgress();