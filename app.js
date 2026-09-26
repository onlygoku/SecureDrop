const $ = (id) => document.getElementById(id);

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
const cancelButton = $("cancelButton");
const actionButton = $("actionButton");

const themeToggle = $("themeToggle");

const progressSection = $("progressSection");
const progressBar = $("progressBar");
const progressPercent = $("progressPercent");
const status = $("status");
const fileStatus = $("fileStatus");

const ambientBackground = document.querySelector(
    ".ambient-background"
);

const ambientParticles = document.getElementById(
    "ambientParticles"
);


/* =========================================================
   STATE
========================================================= */

let selectedFiles = [];
let currentMode = "encrypt";
let operationRunning = false;
let operationController = null;


/* =========================================================
   FILE FORMAT

   Version 2 is chunked.

   Layout:

       4 bytes      magic: SDRP
       4 bytes      header length, big-endian
       N bytes      JSON header
       chunk 0      ciphertext + GCM tag
       chunk 1      ciphertext + GCM tag
       ...

   Every chunk has its own unique 96-bit AES-GCM nonce:

       4 bytes random nonce prefix
       8 bytes chunk index

   Every chunk also authenticates:

       headerBytes + chunkIndex

   This binds the file metadata and chunk ordering.
========================================================= */

const FORMAT = {
    magic: "SDRP",
    version: 2,
    legacyVersion: 1,

    cipher: "AES-256-GCM",
    kdf: "Argon2id",

    memory: 65536,
    iterations: 3,
    parallelism: 2,

    saltLength: 16,
    noncePrefixLength: 4,

    chunkSize: 4 * 1024 * 1024,
    gcmTagLength: 16
};

const MAX_HEADER_SIZE = 1024 * 1024;


/* =========================================================
   INITIAL UI
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

    encryptMode.setAttribute(
        "aria-selected",
        String(!decrypting)
    );

    decryptMode.setAttribute(
        "aria-selected",
        String(decrypting)
    );

    actionButton.textContent = decrypting
        ? "Decrypt"
        : "Encrypt";

    confirmField.style.display = decrypting
        ? "none"
        : "block";

    fileInput.accept = decrypting
        ? ".sdrop"
        : "";

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
            "or click to choose a file from your device";

        chooseFiles.textContent =
            "Choose file";
    }

    renderFiles();
    updateFileStatus();
}


/* =========================================================
   THEME
========================================================= */

const savedTheme = localStorage.getItem(
    "securedrop-theme"
);

if (savedTheme === "dark") {
    document.documentElement.dataset.theme = "dark";
    themeToggle.textContent = "☀";
} else {
    themeToggle.textContent = "☼";
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

        if (currentMode === "encrypt") {
            return;
        }

        currentMode = "encrypt";
        selectedFiles = [];

        password.value = "";
        confirmPassword.value = "";
        fileInput.value = "";

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

        if (currentMode === "decrypt") {
            return;
        }

        currentMode = "decrypt";
        selectedFiles = [];

        password.value = "";
        confirmPassword.value = "";
        fileInput.value = "";

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

        const files = Array.from(
            fileInput.files || []
        );

        if (files.length > 0) {
            addFiles(files);
        }

        fileInput.value = "";
    }
);


/* =========================================================
   DRAG & DROP
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

                if (operationRunning) {
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
                event.dataTransfer?.files || []
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
        const sdropFiles = files.filter(
            (file) =>
                file.name
                    .toLowerCase()
                    .endsWith(".sdrop")
        );

        if (sdropFiles.length === 0) {
            setStatus(
                "Choose a .sdrop package"
            );
            return;
        }

        selectedFiles =
            sdropFiles.slice(0, 1);

    } else {
        /*
         * One source file creates one .sdrop package.
         */
        selectedFiles =
            files.slice(0, 1);
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
            document.createElement("div");

        card.className =
            "file-card";


        const icon =
            document.createElement("div");

        icon.className =
            "file-icon";

        icon.textContent =
            "＋";


        const info =
            document.createElement("div");

        info.className =
            "file-info";


        const name =
            document.createElement("p");

        name.className =
            "file-name";

        name.textContent =
            file.name;


        const size =
            document.createElement("p");

        size.className =
            "file-size";

        size.textContent =
            formatBytes(file.size);


        info.appendChild(name);
        info.appendChild(size);


        const removeButton =
            document.createElement("button");

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


        card.appendChild(icon);
        card.appendChild(info);
        card.appendChild(removeButton);

        fragment.appendChild(card);
    }

    fileList.replaceChildren(
        fragment
    );
}


function updateFileStatus() {
    if (selectedFiles.length === 0) {
        fileStatus.textContent =
            "No files selected";
        return;
    }

    fileStatus.textContent =
        selectedFiles[0].name;
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
        "TB",
        "PB"
    ];

    const index = Math.min(
        Math.floor(
            Math.log(bytes) /
            Math.log(1024)
        ),
        units.length - 1
    );

    return (
        `${(
            bytes /
            Math.pow(1024, index)
        ).toFixed(
            index === 0 ? 0 : 1
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
            password.type === "password";

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

    progressSection.hidden =
        false;

    progressBar.style.width =
        `${percentage}%`;

    progressPercent.textContent =
        `${Math.round(percentage)}%`;

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

    if (cancelButton) {
        cancelButton.hidden =
            !busy;

        cancelButton.disabled =
            !busy;
    }

    dropZone.style.pointerEvents =
        busy
            ? "none"
            : "";

    if (busy) {
        dropZone.classList.remove(
            "dragover"
        );
    }
}


/* =========================================================
   CANCEL
========================================================= */

if (cancelButton) {
    cancelButton.addEventListener(
        "click",
        () => {
            if (
                operationRunning &&
                operationController
            ) {
                operationController.abort();
            }
        }
    );
}


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
   VALIDATION
========================================================= */

function validatePasswordForEncryption() {
    if (!password.value) {
        setStatus(
            "Enter a password"
        );

        password.focus();

        return false;
    }

    if (password.value.length < 8) {
        setStatus(
            "Password must be at least 8 characters"
        );

        password.focus();

        return false;
    }

    if (
        password.value !==
        confirmPassword.value
    ) {
        setStatus(
            "Passwords do not match"
        );

        confirmPassword.focus();

        return false;
    }

    return true;
}


function validatePasswordForDecryption() {
    if (!password.value) {
        setStatus(
            "Enter the password"
        );

        password.focus();

        return false;
    }

    return true;
}


function ensureArgon2Loaded() {
    if (!window.argon2) {
        throw new Error(
            "Argon2 failed to load"
        );
    }
}


/* =========================================================
   ENCRYPTION
========================================================= */

async function encryptFiles() {
    if (operationRunning) {
        return;
    }

    if (
        selectedFiles.length ===
        0
    ) {
        setStatus(
            "Choose a file first"
        );

        return;
    }

    if (
        !validatePasswordForEncryption()
    ) {
        return;
    }

    ensureArgon2Loaded();

    const file =
        selectedFiles[0];

    let writer;


    /*
     * Open the save picker before the first
     * asynchronous crypto operation.
     */

    try {
        writer =
            await createOutputWriter(
                buildEncryptedFilename(
                    file.name
                )
            );

    } catch (error) {

        if (
            error?.name ===
            "AbortError"
        ) {
            setStatus(
                "Save cancelled"
            );

            return;
        }

        console.error(error);

        setStatus(
            error?.message ||
            "Could not open output file"
        );

        return;
    }


    operationController =
        new AbortController();

    const signal =
        operationController.signal;


    setBusy(true);


    try {

        setProgress(
            0,
            "Preparing..."
        );

        await nextFrame();

        throwIfAborted(signal);


        /* Generate crypto parameters */

        const salt =
            crypto.getRandomValues(
                new Uint8Array(
                    FORMAT.saltLength
                )
            );


        const noncePrefix =
            crypto.getRandomValues(
                new Uint8Array(
                    FORMAT.noncePrefixLength
                )
            );


        const chunkCount =
            file.size === 0
                ? 0
                : Math.ceil(
                    file.size /
                    FORMAT.chunkSize
                );


        /* Package metadata */

        const header = {
            magic:
                FORMAT.magic,

            version:
                FORMAT.version,

            format:
                "chunked",

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

            chunkSize:
                FORMAT.chunkSize,

            chunkCount:
                chunkCount,

            fileSize:
                file.size,

            salt:
                bytesToBase64(
                    salt
                ),

            noncePrefix:
                bytesToBase64(
                    noncePrefix
                ),

            filename:
                file.name,

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


        validateHeaderSize(
            headerBytes
        );


        /* Key derivation */

        setProgress(
            8,
            "Deriving encryption key..."
        );


        const keyBytes =
            await deriveKey(
                password.value,
                salt
            );


        throwIfAborted(
            signal
        );


        /* AES key */

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


        throwIfAborted(
            signal
        );


        /* Package header */

        await writer.write(
            createPackagePrefix(
                headerBytes
            )
        );


        /* Encrypt chunks */

        let offset =
            0;

        let chunkIndex =
            0;


        while (
            offset <
            file.size
        ) {

            throwIfAborted(
                signal
            );


            const end =
                Math.min(
                    offset +
                    FORMAT.chunkSize,
                    file.size
                );


            const plaintext =
                new Uint8Array(
                    await file
                        .slice(
                            offset,
                            end
                        )
                        .arrayBuffer()
                );


            throwIfAborted(
                signal
            );


            const nonce =
                makeChunkNonce(
                    noncePrefix,
                    chunkIndex
                );


            const aad =
                makeChunkAAD(
                    headerBytes,
                    chunkIndex
                );


            const encrypted =
                new Uint8Array(
                    await crypto.subtle.encrypt(
                        {
                            name:
                                "AES-GCM",

                            iv:
                                nonce,

                            additionalData:
                                aad,

                            tagLength:
                                128
                        },

                        key,

                        plaintext
                    )
                );


            throwIfAborted(
                signal
            );


            await writer.write(
                encrypted
            );


            offset =
                end;

            chunkIndex++;


            const percentage =
                file.size > 0
                    ? (
                        offset /
                        file.size
                    ) *
                    100
                    : 100;


            setProgress(
                percentage,
                `Encrypting ${formatBytes(offset)} / ${formatBytes(file.size)}`
            );


            /*
             * Give the browser a chance
             * to update the UI.
             */

            await nextFrame();
        }


        throwIfAborted(
            signal
        );


        await writer.close();


        password.value = "";
        confirmPassword.value = "";


        setProgress(
            100,
            "Encryption complete"
        );


        setStatus(
            "SecureDrop package created"
        );


    } catch (error) {

        await writer.abort(
            error
        );


        if (
            isAbortError(
                error
            )
        ) {

            resetProgress();

            setStatus(
                "Operation cancelled"
            );

        } else {

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
        }


    } finally {

        operationController =
            null;

        setBusy(false);
    }
}


/* =========================================================
   DECRYPTION
========================================================= */

async function decryptFiles() {
    if (operationRunning) {
        return;
    }

    if (
        selectedFiles.length ===
        0
    ) {

        setStatus(
            "Choose a .sdrop file first"
        );

        return;
    }


    if (
        !validatePasswordForDecryption()
    ) {
        return;
    }


    ensureArgon2Loaded();


    const packageFile =
        selectedFiles[0];


    const suggestedName =
        packageFile.name.replace(
            /\.sdrop$/i,
            ""
        ) ||
        "decrypted-file";


    let writer;


    try {

        writer =
            await createOutputWriter(
                suggestedName
            );

    } catch (error) {

        if (
            error?.name ===
            "AbortError"
        ) {

            setStatus(
                "Save cancelled"
            );

            return;
        }


        console.error(error);


        setStatus(
            error?.message ||
            "Could not open output file"
        );

        return;
    }


    operationController =
        new AbortController();


    const signal =
        operationController.signal;


    setBusy(true);


    try {

        setProgress(
            0,
            "Preparing..."
        );


        await nextFrame();


        throwIfAborted(
            signal
        );


        const packageInfo =
            await readPackageHeader(
                packageFile
            );


        throwIfAborted(
            signal
        );


        if (
            packageInfo.header.version ===
            FORMAT.version
        ) {

            await decryptV2(
                packageFile,
                packageInfo,
                signal,
                writer
            );

        } else if (
            packageInfo.header.version ===
            FORMAT.legacyVersion
        ) {

            await decryptV1(
                packageFile,
                packageInfo,
                signal,
                writer
            );

        } else {

            throw new Error(
                "Unsupported SecureDrop version"
            );
        }


        throwIfAborted(
            signal
        );


        await writer.close();


        password.value =
            "";

        confirmPassword.value =
            "";


        setProgress(
            100,
            "Decryption complete"
        );


        setStatus(
            "File decrypted successfully"
        );


    } catch (error) {

        await writer.abort(
            error
        );


        if (
            isAbortError(
                error
            )
        ) {

            resetProgress();

            setStatus(
                "Operation cancelled"
            );

        } else {

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
        }


    } finally {

        operationController =
            null;

        setBusy(false);
    }
}


/* =========================================================
   V2 DECRYPTION
========================================================= */

async function decryptV2(
    packageFile,
    packageInfo,
    signal,
    writer
) {

    const header =
        validateV2Header(
            packageInfo.header
        );


    const salt =
        base64ToBytes(
            header.salt
        );


    const noncePrefix =
        base64ToBytes(
            header.noncePrefix
        );


    const expectedPackageSize =
        8 +
        packageInfo.headerLength +
        header.fileSize +
        (
            header.chunkCount *
            FORMAT.gcmTagLength
        );


    if (
        packageFile.size !==
        expectedPackageSize
    ) {

        throw new Error(
            "SecureDrop package is truncated or malformed"
        );
    }


    setProgress(
        8,
        "Deriving encryption key..."
    );


    const keyBytes =
        await deriveKey(
            password.value,
            salt
        );


    throwIfAborted(
        signal
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
                "decrypt"
            ]
        );


    let offset =
        8 +
        packageInfo.headerLength;


    let plaintextWritten =
        0;


    for (
        let chunkIndex = 0;
        chunkIndex <
        header.chunkCount;
        chunkIndex++
    ) {

        throwIfAborted(
            signal
        );


        const remaining =
            header.fileSize -
            plaintextWritten;


        const plaintextLength =
            Math.min(
                header.chunkSize,
                remaining
            );


        const ciphertextLength =
            plaintextLength +
            FORMAT.gcmTagLength;


        const encrypted =
            new Uint8Array(
                await packageFile
                    .slice(
                        offset,
                        offset +
                        ciphertextLength
                    )
                    .arrayBuffer()
            );


        if (
            encrypted.length !==
            ciphertextLength
        ) {

            throw new Error(
                "SecureDrop package is truncated"
            );
        }


        const nonce =
            makeChunkNonce(
                noncePrefix,
                chunkIndex
            );


        const aad =
            makeChunkAAD(
                packageInfo.headerBytes,
                chunkIndex
            );


        const plaintext =
            new Uint8Array(
                await crypto.subtle.decrypt(
                    {
                        name:
                            "AES-GCM",

                        iv:
                            nonce,

                        additionalData:
                            aad,

                        tagLength:
                            128
                    },

                    key,

                    encrypted
                )
            );


        throwIfAborted(
            signal
        );


        if (
            plaintext.length !==
            plaintextLength
        ) {

            throw new Error(
                "Invalid decrypted chunk"
            );
        }


        await writer.write(
            plaintext
        );


        plaintextWritten +=
            plaintext.length;


        offset +=
            ciphertextLength;


        const percentage =
            header.fileSize > 0
                ? (
                    plaintextWritten /
                    header.fileSize
                ) *
                100
                : 100;


        setProgress(
            Math.max(
                8,
                percentage
            ),
            `Decrypting ${formatBytes(plaintextWritten)} / ${formatBytes(header.fileSize)}`
        );


        await nextFrame();
    }


    if (
        plaintextWritten !==
        header.fileSize
    ) {

        throw new Error(
            "Decrypted file size does not match package metadata"
        );
    }


    if (
        offset !==
        packageFile.size
    ) {

        throw new Error(
            "Unexpected data after SecureDrop package"
        );
    }
}


/* =========================================================
   LEGACY V1 DECRYPTION

   Old one-shot SecureDrop packages remain supported.
========================================================= */

async function decryptV1(
    packageFile,
    packageInfo,
    signal,
    writer
) {

    const header =
        validateV1Header(
            packageInfo.header
        );


    setProgress(
        10,
        "Reading legacy SecureDrop package..."
    );


    const entirePackage =
        new Uint8Array(
            await packageFile.arrayBuffer()
        );


    throwIfAborted(
        signal
    );


    const ciphertext =
        entirePackage.slice(
            8 +
            packageInfo.headerLength
        );


    if (
        ciphertext.length ===
        0
    ) {

        throw new Error(
            "Package contains no encrypted data"
        );
    }


    const salt =
        base64ToBytes(
            header.salt
        );


    const nonce =
        base64ToBytes(
            header.nonce
        );


    setProgress(
        20,
        "Deriving encryption key..."
    );


    const keyBytes =
        await deriveKey(
            password.value,
            salt,
            header
        );


    throwIfAborted(
        signal
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
                "decrypt"
            ]
        );


    setProgress(
        60,
        "Decrypting file..."
    );


    const plaintext =
        new Uint8Array(
            await crypto.subtle.decrypt(
                {
                    name:
                        "AES-GCM",

                    iv:
                        nonce,

                    additionalData:
                        packageInfo.headerBytes,

                    tagLength:
                        128
                },

                key,

                ciphertext
            )
        );


    throwIfAborted(
        signal
    );


    await writer.write(
        plaintext
    );


    setProgress(
        100,
        "Decryption complete"
    );
}


/* =========================================================
   ARGON2ID
========================================================= */

async function deriveKey(
    passphrase,
    salt,
    parameters = FORMAT
) {

    const result =
        await window.argon2.hash({

            pass:
                passphrase,

            salt:
                salt,

            time:
                parameters.iterations,

            mem:
                parameters.memory,

            parallelism:
                parameters.parallelism,

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
   PACKAGE PREFIX
========================================================= */

function createPackagePrefix(
    headerBytes
) {

    const magic =
        new TextEncoder().encode(
            FORMAT.magic
        );


    const buffer =
        new ArrayBuffer(
            8 +
            headerBytes.length
        );


    const output =
        new Uint8Array(
            buffer
        );


    const view =
        new DataView(
            buffer
        );


    output.set(
        magic,
        0
    );


    view.setUint32(
        4,
        headerBytes.length,
        false
    );


    output.set(
        headerBytes,
        8
    );


    return output;
}


/* =========================================================
   PACKAGE HEADER
========================================================= */

async function readPackageHeader(
    file
) {

    const prefix =
        new Uint8Array(
            await file
                .slice(
                    0,
                    8
                )
                .arrayBuffer()
        );


    if (
        prefix.length !==
        8
    ) {

        throw new Error(
            "Invalid SecureDrop package"
        );
    }


    const magic =
        new TextDecoder().decode(
            prefix.slice(
                0,
                4
            )
        );


    if (
        magic !==
        FORMAT.magic
    ) {

        throw new Error(
            "Not a SecureDrop package"
        );
    }


    const view =
        new DataView(
            prefix.buffer,
            prefix.byteOffset,
            prefix.byteLength
        );


    const headerLength =
        view.getUint32(
            4,
            false
        );


    if (
        headerLength <= 0 ||
        headerLength >
            MAX_HEADER_SIZE
    ) {

        throw new Error(
            "Invalid package header"
        );
    }


    const headerBytes =
        new Uint8Array(
            await file
                .slice(
                    8,
                    8 +
                    headerLength
                )
                .arrayBuffer()
        );


    if (
        headerBytes.length !==
        headerLength
    ) {

        throw new Error(
            "SecureDrop package is truncated"
        );
    }


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


    if (
        !header ||
        typeof header !==
        "object"
    ) {

        throw new Error(
            "Invalid package metadata"
        );
    }


    return {
        header,
        headerBytes,
        headerLength
    };
}


/* =========================================================
   HEADER VALIDATION
========================================================= */

function validateV2Header(
    header
) {

    if (
        header.magic !==
        FORMAT.magic
    ) {

        throw new Error(
            "Invalid SecureDrop package"
        );
    }


    if (
        header.version !==
        FORMAT.version
    ) {

        throw new Error(
            "Unsupported SecureDrop version"
        );
    }


    if (
        header.format !==
        "chunked"
    ) {

        throw new Error(
            "Unsupported SecureDrop format"
        );
    }


    if (
        header.cipher !==
        FORMAT.cipher
    ) {

        throw new Error(
            "Unsupported encryption algorithm"
        );
    }


    if (
        header.kdf !==
        FORMAT.kdf
    ) {

        throw new Error(
            "Unsupported key derivation function"
        );
    }


    if (
        !Number.isSafeInteger(
            header.chunkSize
        ) ||
        header.chunkSize <=
            0 ||
        header.chunkSize >
            64 * 1024 * 1024
    ) {

        throw new Error(
            "Invalid SecureDrop chunk size"
        );
    }


    if (
        !Number.isSafeInteger(
            header.fileSize
        ) ||
        header.fileSize <
            0
    ) {

        throw new Error(
            "Invalid SecureDrop file size"
        );
    }


    if (
        !Number.isSafeInteger(
            header.chunkCount
        ) ||
        header.chunkCount <
            0
    ) {

        throw new Error(
            "Invalid SecureDrop chunk count"
        );
    }


    const expectedChunkCount =
        header.fileSize === 0
            ? 0
            : Math.ceil(
                header.fileSize /
                header.chunkSize
            );


    if (
        header.chunkCount !==
        expectedChunkCount
    ) {

        throw new Error(
            "Invalid SecureDrop chunk count"
        );
    }


    if (
        !Number.isSafeInteger(
            header.memory
        ) ||
        header.memory <= 0 ||

        !Number.isSafeInteger(
            header.iterations
        ) ||
        header.iterations <= 0 ||

        !Number.isSafeInteger(
            header.parallelism
        ) ||
        header.parallelism <= 0
    ) {

        throw new Error(
            "Invalid KDF parameters"
        );
    }


    const salt =
        base64ToBytes(
            header.salt
        );


    const noncePrefix =
        base64ToBytes(
            header.noncePrefix
        );


    if (
        salt.length !==
        FORMAT.saltLength
    ) {

        throw new Error(
            "Invalid SecureDrop salt"
        );
    }


    if (
        noncePrefix.length !==
        FORMAT.noncePrefixLength
    ) {

        throw new Error(
            "Invalid SecureDrop nonce prefix"
        );
    }


    if (
        typeof header.filename !==
        "string" ||
        header.filename.length ===
        0
    ) {

        throw new Error(
            "Invalid original filename"
        );
    }


    return header;
}


function validateV1Header(
    header
) {

    if (
        header.magic !==
        FORMAT.magic
    ) {

        throw new Error(
            "Invalid SecureDrop package"
        );
    }


    if (
        header.version !==
        FORMAT.legacyVersion
    ) {

        throw new Error(
            "Unsupported SecureDrop version"
        );
    }


    if (
        header.cipher !==
        FORMAT.cipher
    ) {

        throw new Error(
            "Unsupported encryption algorithm"
        );
    }


    if (
        header.kdf !==
        FORMAT.kdf
    ) {

        throw new Error(
            "Unsupported key derivation function"
        );
    }


    if (
        !Number.isSafeInteger(
            header.memory
        ) ||
        header.memory <= 0 ||

        !Number.isSafeInteger(
            header.iterations
        ) ||
        header.iterations <= 0 ||

        !Number.isSafeInteger(
            header.parallelism
        ) ||
        header.parallelism <= 0
    ) {

        throw new Error(
            "Invalid KDF parameters"
        );
    }


    const salt =
        base64ToBytes(
            header.salt
        );


    const nonce =
        base64ToBytes(
            header.nonce
        );


    if (
        salt.length !==
        16
    ) {

        throw new Error(
            "Invalid SecureDrop salt"
        );
    }


    if (
        nonce.length !==
        12
    ) {

        throw new Error(
            "Invalid SecureDrop nonce"
        );
    }


    return header;
}


function validateHeaderSize(
    headerBytes
) {

    if (
        headerBytes.length <=
        0 ||
        headerBytes.length >
        MAX_HEADER_SIZE
    ) {

        throw new Error(
            "SecureDrop metadata is too large"
        );
    }
}


/* =========================================================
   CHUNK NONCE
========================================================= */

function makeChunkNonce(
    noncePrefix,
    chunkIndex
) {

    const nonce =
        new Uint8Array(
            12
        );


    nonce.set(
        noncePrefix,
        0
    );


    const view =
        new DataView(
            nonce.buffer
        );


    view.setBigUint64(
        4,
        BigInt(chunkIndex),
        false
    );


    return nonce;
}


/* =========================================================
   CHUNK AAD
========================================================= */

function makeChunkAAD(
    headerBytes,
    chunkIndex
) {

    const aad =
        new Uint8Array(
            headerBytes.length +
            8
        );


    aad.set(
        headerBytes,
        0
    );


    const view =
        new DataView(
            aad.buffer
        );


    view.setBigUint64(
        headerBytes.length,
        BigInt(chunkIndex),
        false
    );


    return aad;
}


/* =========================================================
   OUTPUT WRITER
========================================================= */

async function createOutputWriter(
    suggestedName
) {

    /*
     * Preferred path:
     * File System Access API.
     */

    if (
        typeof window.showSaveFilePicker ===
        "function"
    ) {

        const handle =
            await window.showSaveFilePicker({

                suggestedName,

                types: [
                    {
                        description:
                            "SecureDrop file",

                        accept: {
                            "application/octet-stream": [
                                ".sdrop"
                            ]
                        }
                    }
                ]
            });


        const writable =
            await handle.createWritable();


        return {

            write:
                (chunk) =>
                    writable.write(
                        chunk
                    ),

            close:
                () =>
                    writable.close(),

            abort:
                async (reason) => {
                    try {
                        await writable.abort(
                            reason
                        );
                    } catch {
                        /*
                         * Ignore cleanup errors.
                         */
                    }
                }
        };
    }


    /*
     * Fallback for browsers without
     * File System Access API.
     *
     * This path stores chunks in memory
     * until the final Blob is created.
     */

    const chunks = [];


    return {

        write:
            async (chunk) => {
                chunks.push(
                    chunk
                );
            },

        close:
            async () => {

                const blob =
                    new Blob(
                        chunks,
                        {
                            type:
                                "application/octet-stream"
                        }
                    );


                downloadBlob(
                    blob,
                    suggestedName
                );


                chunks.length = 0;
            },

        abort:
            async () => {
                chunks.length = 0;
            }
    };
}


/* =========================================================
   BLOB DOWNLOAD
========================================================= */

function downloadBlob(
    blob,
    filename
) {

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
   ENCRYPTED FILENAME
========================================================= */

function buildEncryptedFilename(
    filename
) {

    const cleanName =
        filename.replace(
            /\.sdrop$/i,
            ""
        );


    return (
        `${cleanName || "encrypted-file"}.sdrop`
    );
}


/* =========================================================
   BASE64
========================================================= */

function bytesToBase64(
    bytes
) {

    let binary = "";

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
   ABORT / UTILITIES
========================================================= */

function throwIfAborted(
    signal
) {

    if (
        signal.aborted
    ) {

        throw new DOMException(
            "Operation cancelled",
            "AbortError"
        );
    }
}


function isAbortError(
    error
) {

    return (
        error?.name ===
        "AbortError"
    );
}


function nextFrame() {

    return new Promise(
        (resolve) =>
            requestAnimationFrame(
                resolve
            )
    );
}


function setStatus(
    message
) {

    status.textContent =
        message;
}


/* =========================================================
   AMBIENT PARTICLES
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


        const properties = {

            "--size":
                `${Math.random() * 3 + 2}px`,

            "--x":
                `${Math.random() * 100}%`,

            "--y":
                `${Math.random() * 100}%`,

            "--move-x":
                `${(
                    Math.random() - 0.5
                ) * 160}px`,

            "--move-y":
                `${(
                    Math.random() - 0.5
                ) * 160}px`,

            "--move-x-end":
                `${(
                    Math.random() - 0.5
                ) * 220}px`,

            "--move-y-end":
                `${(
                    Math.random() - 0.5
                ) * 220}px`,

            "--duration":
                `${8 + Math.random() * 10}s`,

            "--delay":
                `${Math.random() * -12}s`,

            "--particle-color":
                colors[
                    Math.floor(
                        Math.random() *
                        colors.length
                    )
                ]
        };


        Object.entries(
            properties
        ).forEach(
            ([key, value]) => {

                particle.style.setProperty(
                    key,
                    value
                );
            }
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
   BACKGROUND PARALLAX
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

updateUI();

/*
 * Critical:
 * Hide progress until an operation actually starts.
 */

resetProgress();