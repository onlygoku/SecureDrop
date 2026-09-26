/* =========================================================
   DOM HELPER
========================================================= */

const $ = (id) =>
    document.getElementById(id);


/* =========================================================
   ELEMENTS
========================================================= */

const dropZone =
    $("dropZone");

const dropTitle =
    $("dropTitle");

const dropSubtitle =
    $("dropSubtitle");

const fileInput =
    $("fileInput");

const chooseFiles =
    $("chooseFiles");

const fileList =
    $("fileList");

const password =
    $("password");

const confirmPassword =
    $("confirmPassword");

const confirmField =
    $("confirmField");

const showPassword =
    $("showPassword");

const encryptMode =
    $("encryptMode");

const decryptMode =
    $("decryptMode");

const clearButton =
    $("clearButton");

const actionButton =
    $("actionButton");

const themeToggle =
    $("themeToggle");

const progressSection =
    $("progressSection");

const progressBar =
    $("progressBar");

const progressPercent =
    $("progressPercent");

const status =
    $("status");

const fileStatus =
    $("fileStatus");

const ambientBackground =
    document.querySelector(
        ".ambient-background"
    );

const ambientParticles =
    document.getElementById(
        "ambientParticles"
    );


/* =========================================================
   STATE
========================================================= */

let selectedFiles = [];

let currentMode =
    "encrypt";

let operationRunning =
    false;


/* =========================================================
   FORMAT
========================================================= */

const FORMAT = {

    magic:
        "SDRP",

    version:
        1,

    cipher:
        "AES-256-GCM",

    kdf:
        "Argon2id",

    memory:
        65536,

    iterations:
        3,

    parallelism:
        2,

    saltLength:
        16,

    nonceLength:
        12
};


/* =========================================================
   UI
========================================================= */

function updateUI() {

    const decrypting =
        currentMode ===
        "decrypt";


    /* Mode */

    encryptMode.classList.toggle(
        "active",
        !decrypting
    );

    decryptMode.classList.toggle(
        "active",
        decrypting
    );


    encryptMode.setAttribute(
        "aria-selected",
        String(!decrypting)
    );

    decryptMode.setAttribute(
        "aria-selected",
        String(decrypting)
    );


    /* Button */

    actionButton.textContent =
        decrypting
            ? "Decrypt"
            : "Encrypt";


    /* Confirmation */

    confirmField.style.display =
        decrypting
            ? "none"
            : "block";


    /* File input */

    fileInput.accept =
        decrypting
            ? ".sdrop"
            : "";


    /* Drop zone */

    if (decrypting) {

        dropTitle.textContent =
            "Drop a .sdrop package here";

        dropSubtitle.textContent =
            "or click to choose an encrypted package";

        chooseFiles.textContent =
            "Choose package";

    } else {

        dropTitle.textContent =
            "Drop files here";

        dropSubtitle.textContent =
            "or click to choose files from your device";

        chooseFiles.textContent =
            "Choose file";
    }


    renderFiles();

    updateFileStatus();
}


/* =========================================================
   THEME
========================================================= */

const savedTheme =
    localStorage.getItem(
        "securedrop-theme"
    );


if (
    savedTheme ===
    "dark"
) {

    document.documentElement.dataset.theme =
        "dark";

    themeToggle.textContent =
        "☀";

} else {

    themeToggle.textContent =
        "☼";
}


themeToggle.addEventListener(
    "click",
    () => {

        if (operationRunning) {
            return;
        }


        const dark =
            document
                .documentElement
                .dataset
                .theme ===
            "dark";


        if (dark) {

            delete document
                .documentElement
                .dataset
                .theme;

            themeToggle.textContent =
                "☼";

            localStorage.setItem(
                "securedrop-theme",
                "light"
            );

        } else {

            document
                .documentElement
                .dataset
                .theme =
                "dark";

            themeToggle.textContent =
                "☀";

            localStorage.setItem(
                "securedrop-theme",
                "dark"
            );
        }
    }
);


/* =========================================================
   MODE SWITCHING
========================================================= */

encryptMode.addEventListener(
    "click",
    () => {

        if (operationRunning) {
            return;
        }


        currentMode =
            "encrypt";


        selectedFiles =
            [];


        password.value =
            "";

        confirmPassword.value =
            "";

        fileInput.value =
            "";


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


        currentMode =
            "decrypt";


        selectedFiles =
            [];


        password.value =
            "";

        confirmPassword.value =
            "";

        fileInput.value =
            "";


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
            Array.from(
                fileInput.files
            );


        if (files.length > 0) {
            addFiles(files);
        }


        fileInput.value =
            "";
    }
);


/* =========================================================
   DRAG AND DROP
========================================================= */

[
    "dragenter",
    "dragover"
].forEach(
    (eventName) => {

        dropZone.addEventListener(
            eventName,
            (event) => {

                event.preventDefault();

                event.stopPropagation();


                if (
                    operationRunning
                ) {
                    return;
                }


                dropZone.classList.add(
                    "dragover"
                );
            }
        );
    }
);


[
    "dragleave",
    "drop"
].forEach(
    (eventName) => {

        dropZone.addEventListener(
            eventName,
            (event) => {

                event.preventDefault();

                event.stopPropagation();


                dropZone.classList.remove(
                    "dragover"
                );
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


    if (
        currentMode ===
        "decrypt"
    ) {

        const sdropFiles =
            files.filter(
                (file) =>
                    file.name
                        .toLowerCase()
                        .endsWith(".sdrop")
            );


        if (
            sdropFiles.length ===
            0
        ) {

            setStatus(
                "Choose a .sdrop package"
            );

            return;
        }


        selectedFiles =
            sdropFiles.slice(
                0,
                1
            );

    } else {

        /*
         * One source file is used
         * to create one .sdrop package.
         */

        selectedFiles =
            files.slice(
                0,
                1
            );
    }


    renderFiles();

    updateFileStatus();

    resetProgress();
}


function renderFiles() {

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
            document.createElement(
                "div"
            );

        card.className =
            "file-card";


        /* Icon */

        const icon =
            document.createElement(
                "div"
            );

        icon.className =
            "file-icon";

        icon.textContent =
            "＋";


        /* Info */

        const info =
            document.createElement(
                "div"
            );

        info.className =
            "file-info";


        const name =
            document.createElement(
                "p"
            );

        name.className =
            "file-name";

        name.textContent =
            file.name;


        const size =
            document.createElement(
                "p"
            );

        size.className =
            "file-size";

        size.textContent =
            formatBytes(
                file.size
            );


        info.appendChild(
            name
        );

        info.appendChild(
            size
        );


        /* Remove button */

        const removeButton =
            document.createElement(
                "button"
            );

        removeButton.className =
            "file-remove";

        removeButton.type =
            "button";

        removeButton.textContent =
            "×";

        removeButton.setAttribute(
            "aria-label",
            `Remove ${file.name}`
        );


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


        card.appendChild(
            icon
        );

        card.appendChild(
            info
        );

        card.appendChild(
            removeButton
        );


        fragment.appendChild(
            card
        );
    }


    fileList.replaceChildren(
        fragment
    );
}


function updateFileStatus() {

    if (
        selectedFiles.length ===
        0
    ) {

        fileStatus.textContent =
            "No files selected";

        return;
    }


    if (
        selectedFiles.length ===
        1
    ) {

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


    const index =
        Math.floor(
            Math.log(bytes) /
            Math.log(1024)
        );


    return (
        `${(
            bytes /
            Math.pow(
                1024,
                index
            )
        ).toFixed(
            index === 0
                ? 0
                : 1
        )} ${units[index]}`
    );
}


/* =========================================================
   PASSWORD
========================================================= */

showPassword.addEventListener(
    "click",
    () => {

        const visible =
            password.type ===
            "password";


        password.type =
            visible
                ? "text"
                : "password";


        confirmPassword.type =
            visible
                ? "text"
                : "password";


        showPassword.textContent =
            visible
                ? "Hide"
                : "Show";
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


        selectedFiles =
            [];


        password.value =
            "";

        confirmPassword.value =
            "";

        fileInput.value =
            "";


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
            Math.min(
                100,
                value
            )
        );


    /*
     * Progress is visible only
     * when an operation starts.
     */

    progressSection.hidden =
        false;


    progressBar.style.width =
        `${percentage}%`;


    progressPercent.textContent =
        `${Math.round(
            percentage
        )}%`;


    if (message) {

        status.textContent =
            message;
    }
}


function resetProgress() {

    progressBar.style.width =
        "0%";


    progressPercent.textContent =
        "0%";


    status.textContent =
        "Ready";


    /*
     * Hide progress when idle.
     */

    progressSection.hidden =
        true;
}


/* =========================================================
   BUSY STATE
========================================================= */

function setBusy(busy) {

    operationRunning =
        busy;


    encryptMode.disabled =
        busy;

    decryptMode.disabled =
        busy;


    chooseFiles.disabled =
        busy;

    clearButton.disabled =
        busy;

    actionButton.disabled =
        busy;


    password.disabled =
        busy;

    confirmPassword.disabled =
        busy;

    showPassword.disabled =
        busy;


    themeToggle.disabled =
        busy;


    if (busy) {

        dropZone.classList.remove(
            "dragover"
        );
    }
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


        if (
            currentMode ===
            "encrypt"
        ) {

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

        /* File */

        if (
            selectedFiles.length ===
            0
        ) {

            setStatus(
                "Choose a file first"
            );

            return;
        }


        /* Password */

        if (!password.value) {

            setStatus(
                "Enter a password"
            );

            password.focus();

            return;
        }


        /* Minimum length */

        if (
            password.value.length <
            8
        ) {

            setStatus(
                "Password must be at least 8 characters"
            );

            password.focus();

            return;
        }


        /* Confirmation */

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


        /* Argon2 */

        if (!window.argon2) {

            throw new Error(
                "Argon2 failed to load"
            );
        }


        setBusy(true);


        /* Initial state */

        setProgress(
            0,
            "Preparing..."
        );


        /*
         * Give the browser time to
         * render the progress state.
         */

        await new Promise(
            (resolve) =>
                requestAnimationFrame(
                    resolve
                )
        );


        const file =
            selectedFiles[0];


        /* Read */

        setProgress(
            5,
            "Reading file..."
        );


        const plaintext =
            new Uint8Array(
                await file.arrayBuffer()
            );


        /* Salt */

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


        /* Nonce */

        const nonce =
            crypto.getRandomValues(
                new Uint8Array(
                    FORMAT.nonceLength
                )
            );


        /* Argon2 */

        setProgress(
            25,
            "Deriving encryption key..."
        );


        const keyBytes =
            await deriveKey(
                password.value,
                salt
            );


        /* AES key */

        setProgress(
            45,
            "Preparing AES-256-GCM..."
        );


        const key =
            await crypto.subtle.importKey(
                "raw",
                keyBytes,
                {
                    name:
                        "AES-GCM"
                },
                false,
                [
                    "encrypt"
                ]
            );


        /* Metadata */

        const header = {

            magic:
                FORMAT.magic,

            version:
                FORMAT.version,

            cipher:
                FORMAT.cipher,

            kdf:
                FORMAT.kdf,

            memory:
                FORMAT.memory,

            iterations:
                FORMAT.iterations,

            parallelism:
                FORMAT.parallelism,

            salt:
                bytesToBase64(
                    salt
                ),

            nonce:
                bytesToBase64(
                    nonce
                ),

            filename:
                file.name,

            size:
                file.size,

            mime:
                file.type ||
                "application/octet-stream"
        };


        const headerBytes =
            new TextEncoder().encode(
                JSON.stringify(
                    header
                )
            );


        /* Encrypt */

        setProgress(
            60,
            "Encrypting file..."
        );


        const encrypted =
            await crypto.subtle.encrypt(
                {
                    name:
                        "AES-GCM",

                    iv:
                        nonce,

                    additionalData:
                        headerBytes,

                    tagLength:
                        128
                },

                key,

                plaintext
            );


        /* Package */

        setProgress(
            85,
            "Building SecureDrop package..."
        );


        const packageBytes =
            createPackage(
                headerBytes,
                new Uint8Array(
                    encrypted
                )
            );


        /* Name */

        const outputName =
            file.name.replace(
                /\.[^/.]+$/,
                ""
            ) +
            ".sdrop";


        /* Download */

        downloadFile(
            packageBytes,
            outputName,
            "application/octet-stream"
        );


        /* Done */

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

        /* Package */

        if (
            selectedFiles.length ===
            0
        ) {

            setStatus(
                "Choose a .sdrop file first"
            );

            return;
        }


        /* Password */

        if (!password.value) {

            setStatus(
                "Enter the password"
            );

            password.focus();

            return;
        }


        /* Argon2 */

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
                requestAnimationFrame(
                    resolve
                )
        );


        const packageFile =
            selectedFiles[0];


        /* Read */

        setProgress(
            5,
            "Reading SecureDrop package..."
        );


        const packageBytes =
            new Uint8Array(
                await packageFile.arrayBuffer()
            );


        /* Parse */

        setProgress(
            20,
            "Reading package metadata..."
        );


        const parsed =
            parsePackage(
                packageBytes
            );


        /* Magic */

        if (
            parsed.header.magic !==
            FORMAT.magic
        ) {

            throw new Error(
                "Invalid SecureDrop package"
            );
        }


        /* Version */

        if (
            parsed.header.version !==
            FORMAT.version
        ) {

            throw new Error(
                "Unsupported SecureDrop version"
            );
        }


        /* KDF */

        if (
            parsed.header.kdf !==
            FORMAT.kdf
        ) {

            throw new Error(
                "Unsupported key derivation function"
            );
        }


        /* Cipher */

        if (
            parsed.header.cipher !==
            FORMAT.cipher
        ) {

            throw new Error(
                "Unsupported encryption algorithm"
            );
        }


        /* Metadata */

        if (
            typeof
            parsed.header.salt !==
            "string"
        ) {

            throw new Error(
                "Invalid package salt"
            );
        }


        if (
            typeof
            parsed.header.nonce !==
            "string"
        ) {

            throw new Error(
                "Invalid package nonce"
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


        /* Key */

        setProgress(
            35,
            "Deriving encryption key..."
        );


        const keyBytes =
            await deriveKey(
                password.value,
                salt
            );


        /* AES */

        const key =
            await crypto.subtle.importKey(
                "raw",
                keyBytes,
                {
                    name:
                        "AES-GCM"
                },
                false,
                [
                    "decrypt"
                ]
            );


        /* Decrypt */

        setProgress(
            65,
            "Decrypting file..."
        );


        const decrypted =
            await crypto.subtle.decrypt(
                {
                    name:
                        "AES-GCM",

                    iv:
                        nonce,

                    additionalData:
                        parsed.headerBytes,

                    tagLength:
                        128
                },

                key,

                parsed.ciphertext
            );


        /* Restore */

        setProgress(
            90,
            "Preparing decrypted file..."
        );


        const filename =
            parsed.header.filename ||
            "decrypted-file";


        downloadFile(
            new Uint8Array(
                decrypted
            ),

            filename,

            parsed.header.mime ||
            "application/octet-stream"
        );


        /* Done */

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

            pass:
                passphrase,

            salt:
                salt,

            time:
                FORMAT.iterations,

            mem:
                FORMAT.memory,

            parallelism:
                FORMAT.parallelism,

            hashLen:
                32,

            type:
                window
                    .argon2
                    .ArgonType
                    .Argon2id
        });


    return result.hash;
}


/* =========================================================
   PACKAGE CREATION
========================================================= */

function createPackage(
    headerBytes,
    ciphertext
) {

    /*
     * Package format:
     *
     * 4 bytes   magic
     * 4 bytes   header length
     * N bytes   JSON header
     * remaining ciphertext
     */


    const magic =
        new TextEncoder().encode(
            "SDRP"
        );


    const totalLength =
        4 +
        4 +
        headerBytes.length +
        ciphertext.length;


    const buffer =
        new ArrayBuffer(
            totalLength
        );


    const output =
        new Uint8Array(
            buffer
        );


    const view =
        new DataView(
            buffer
        );


    let offset =
        0;


    /* Magic */

    output.set(
        magic,
        offset
    );


    offset +=
        4;


    /* Header length */

    view.setUint32(
        offset,
        headerBytes.length,
        false
    );


    offset +=
        4;


    /* Header */

    output.set(
        headerBytes,
        offset
    );


    offset +=
        headerBytes.length;


    /* Ciphertext */

    output.set(
        ciphertext,
        offset
    );


    return output;
}


/* =========================================================
   PACKAGE PARSING
========================================================= */

function parsePackage(
    bytes
) {

    if (
        bytes.length <
        8
    ) {

        throw new Error(
            "Invalid SecureDrop package"
        );
    }


    const decoder =
        new TextDecoder();


    /* Magic */

    const magic =
        decoder.decode(
            bytes.slice(
                0,
                4
            )
        );


    if (
        magic !==
        "SDRP"
    ) {

        throw new Error(
            "Not a SecureDrop package"
        );
    }


    /* View */

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


    /* Validate */

    if (
        headerLength <= 0 ||
        headerLength >
            bytes.length - 8
    ) {

        throw new Error(
            "Invalid package header"
        );
    }


    const headerStart =
        8;


    const headerEnd =
        headerStart +
        headerLength;


    /* Header */

    const headerBytes =
        bytes.slice(
            headerStart,
            headerEnd
        );


    /* Ciphertext */

    const ciphertext =
        bytes.slice(
            headerEnd
        );


    if (
        ciphertext.length ===
        0
    ) {

        throw new Error(
            "Package contains no encrypted data"
        );
    }


    /* JSON */

    let header;


    try {

        header =
            JSON.parse(
                new TextDecoder().decode(
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
            [
                bytes
            ],
            {
                type:
                    mimeType
            }
        );


    const url =
        URL.createObjectURL(
            blob
        );


    const link =
        document.createElement(
            "a"
        );


    link.href =
        url;


    link.download =
        filename;


    document.body.appendChild(
        link
    );


    link.click();


    link.remove();


    setTimeout(
        () => {

            URL.revokeObjectURL(
                url
            );

        },
        1000
    );
}


/* =========================================================
   BASE64
========================================================= */

function bytesToBase64(
    bytes
) {

    let binary =
        "";


    const chunkSize =
        0x8000;


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


    return btoa(
        binary
    );
}


function base64ToBytes(
    base64
) {

    let binary;


    try {

        binary =
            atob(
                base64
            );

    } catch {

        throw new Error(
            "Invalid package encoding"
        );
    }


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
            binary.charCodeAt(
                i
            );
    }


    return bytes;
}


/* =========================================================
   STATUS
========================================================= */

function setStatus(
    message
) {

    status.textContent =
        message;
}


/* =========================================================
   DYNAMIC PARTICLES
========================================================= */

function createAmbientParticles() {

    if (
        !ambientParticles
    ) {
        return;
    }


    const particleCount =
        18;


    const colors = [

        "rgba(0, 113, 227, 0.65)",

        "rgba(70, 130, 255, 0.55)",

        "rgba(120, 90, 255, 0.45)",

        "rgba(0, 180, 255, 0.50)"
    ];


    const fragment =
        document.createDocumentFragment();


    for (
        let i = 0;
        i < particleCount;
        i++
    ) {

        const particle =
            document.createElement(
                "div"
            );


        particle.className =
            "ambient-particle";


        const size =
            Math.random() *
            3 +
            2;


        const x =
            Math.random() *
            100;


        const y =
            Math.random() *
            100;


        const moveX =
            (
                Math.random() -
                0.5
            ) *
            160;


        const moveY =
            (
                Math.random() -
                0.5
            ) *
            160;


        const endX =
            (
                Math.random() -
                0.5
            ) *
            220;


        const endY =
            (
                Math.random() -
                0.5
            ) *
            220;


        const duration =
            8 +
            Math.random() *
            10;


        const delay =
            Math.random() *
            -12;


        const color =
            colors[
                Math.floor(
                    Math.random() *
                    colors.length
                )
            ];


        particle.style.setProperty(
            "--size",
            `${size}px`
        );


        particle.style.setProperty(
            "--x",
            `${x}%`
        );


        particle.style.setProperty(
            "--y",
            `${y}%`
        );


        particle.style.setProperty(
            "--move-x",
            `${moveX}px`
        );


        particle.style.setProperty(
            "--move-y",
            `${moveY}px`
        );


        particle.style.setProperty(
            "--move-x-end",
            `${endX}px`
        );


        particle.style.setProperty(
            "--move-y-end",
            `${endY}px`
        );


        particle.style.setProperty(
            "--duration",
            `${duration}s`
        );


        particle.style.setProperty(
            "--delay",
            `${delay}s`
        );


        particle.style.setProperty(
            "--particle-color",
            color
        );


        fragment.appendChild(
            particle
        );
    }


    ambientParticles.replaceChildren(
        fragment
    );
}


createAmbientParticles();


/* =========================================================
   MOUSE PARALLAX
========================================================= */

if (
    ambientBackground &&
    !window.matchMedia(
        "(prefers-reduced-motion: reduce)"
    ).matches
) {

    let parallaxFrame =
        null;


    window.addEventListener(
        "pointermove",
        (event) => {

            if (
                parallaxFrame !==
                null
            ) {
                return;
            }


            parallaxFrame =
                requestAnimationFrame(
                    () => {

                        const x =
                            (
                                event.clientX /
                                window.innerWidth -
                                0.5
                            ) *
                            2;


                        const y =
                            (
                                event.clientY /
                                window.innerHeight -
                                0.5
                            ) *
                            2;


                        ambientBackground.style.setProperty(
                            "--mouse-x",
                            `${x * 30}px`
                        );


                        ambientBackground.style.setProperty(
                            "--mouse-y",
                            `${y * 30}px`
                        );


                        parallaxFrame =
                            null;
                    }
                );
        },
        {
            passive:
                true
        }
    );
}


/* =========================================================
   STARTUP
========================================================= */

/*
 * Build normal UI.
 */

updateUI();


/*
 * IMPORTANT:
 *
 * Progress starts hidden.
 * It becomes visible only when
 * encryption or decryption starts.
 */

resetProgress();