// VAULT CRYPTO (STRK-176)
// =============================================================================
// AES-256-GCM crypto abstraction for the encrypted vault backup (.stvault):
// backend detection, random bytes, PBKDF2 key derivation, and encrypt/decrypt —
// Web Crypto API (primary) with a node-forge fallback for the file:// protocol.
// Extracted verbatim from js/vault.js to keep each file under the Codacy Lizard
// file-nloc gate (1500). Pure code motion — no behavior change.
//
// MUST load BEFORE js/vault.js. These are bare global `function` declarations
// (no IIFE), so vault.js keeps calling them as globals with no call-site change.
// Every call site runs at runtime (never at parse time), so load order alone is
// sufficient. External dependencies are the `crypto` (Web Crypto) and `forge`
// globals plus debugLog() — all resolved at call time.
// =============================================================================

/**
 * Detect available crypto backend.
 * @returns {'native'|'forge'|null}
 */
function getCryptoBackend() {
  try {
    if (
      typeof crypto !== "undefined" &&
      crypto.subtle &&
      typeof crypto.subtle.importKey === "function"
    ) {
      return "native";
    }
  } catch (err) {
    debugLog("[Vault] Crypto backend detection failed: " + err.message, "info");
  }
  try {
    if (typeof forge !== "undefined" && forge.cipher && forge.pkcs5) {
      return "forge";
    }
  } catch (err) {
    debugLog("[Vault] Crypto backend detection failed: " + err.message, "info");
  }
  return null;
}

/**
 * Generate cryptographically random bytes.
 * @param {number} length
 * @returns {Uint8Array}
 */
function vaultRandomBytes(length) {
  const backend = getCryptoBackend();
  if (backend === "native") {
    return crypto.getRandomValues(new Uint8Array(length));
  }
  if (backend === "forge") {
    const bytes = forge.random.getBytesSync(length);
    return new Uint8Array(
      bytes.split("").map(function (c) {
        return c.charCodeAt(0);
      })
    );
  }
  throw new Error("No crypto backend available");
}

/**
 * Derive AES-256 key from password using PBKDF2.
 * @param {string} password
 * @param {Uint8Array} salt - 32-byte salt
 * @param {number} iterations
 * @returns {Promise<CryptoKey|string>} Native CryptoKey or forge key bytes
 */
async function vaultDeriveKey(password, salt, iterations) {
  const backend = getCryptoBackend();
  if (backend === "native") {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: iterations,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }
  if (backend === "forge") {
    var saltStr = String.fromCharCode.apply(null, salt);
    var key = forge.pkcs5.pbkdf2(password, saltStr, iterations, 32, "sha256");
    return key;
  }
  throw new Error("No crypto backend available");
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * @param {Uint8Array} plaintext
 * @param {CryptoKey|string} key
 * @param {Uint8Array} iv - 12-byte nonce
 * @returns {Promise<Uint8Array>} ciphertext + 16-byte auth tag
 */
async function vaultEncrypt(plaintext, key, iv) {
  var backend = getCryptoBackend();
  if (backend === "native") {
    var result = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, plaintext);
    return new Uint8Array(result);
  }
  if (backend === "forge") {
    var cipher = forge.cipher.createCipher("AES-GCM", key);
    var ivStr = String.fromCharCode.apply(null, iv);
    cipher.start({ iv: ivStr, tagLength: 128 });
    cipher.update(forge.util.createBuffer(String.fromCharCode.apply(null, plaintext)));
    cipher.finish();

    var encrypted = cipher.output.getBytes();
    var tag = cipher.mode.tag.getBytes();

    var combined = new Uint8Array(encrypted.length + tag.length);
    for (var i = 0; i < encrypted.length; i++) {
      combined[i] = encrypted.charCodeAt(i);
    }
    for (var j = 0; j < tag.length; j++) {
      combined[encrypted.length + j] = tag.charCodeAt(j);
    }
    return combined;
  }
  throw new Error("No crypto backend available");
}

/**
 * Decrypt ciphertext with AES-256-GCM.
 * @param {Uint8Array} ciphertext - ciphertext + 16-byte auth tag
 * @param {CryptoKey|string} key
 * @param {Uint8Array} iv - 12-byte nonce
 * @returns {Promise<Uint8Array>} plaintext
 * @throws {Error} On wrong password or corrupted data (GCM auth tag mismatch)
 */
async function vaultDecrypt(ciphertext, key, iv) {
  var backend = getCryptoBackend();
  if (backend === "native") {
    try {
      var result = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ciphertext);
      return new Uint8Array(result);
    } catch (_) {
      throw new Error("Incorrect password or corrupted file.");
    }
  }
  if (backend === "forge") {
    // Split ciphertext and tag (last 16 bytes)
    var tagLength = 16;
    if (ciphertext.length < tagLength) {
      throw new Error("Incorrect password or corrupted file.");
    }
    var encBytes = ciphertext.slice(0, ciphertext.length - tagLength);
    var tagBytes = ciphertext.slice(ciphertext.length - tagLength);

    var encStr = String.fromCharCode.apply(null, encBytes);
    var tagStr = String.fromCharCode.apply(null, tagBytes);
    var ivStr = String.fromCharCode.apply(null, iv);

    var decipher = forge.cipher.createDecipher("AES-GCM", key);
    decipher.start({
      iv: ivStr,
      tagLength: 128,
      tag: forge.util.createBuffer(tagStr),
    });
    decipher.update(forge.util.createBuffer(encStr));
    var pass = decipher.finish();

    if (!pass) {
      throw new Error("Incorrect password or corrupted file.");
    }
    var output = decipher.output.getBytes();
    return new Uint8Array(
      output.split("").map(function (c) {
        return c.charCodeAt(0);
      })
    );
  }
  throw new Error("No crypto backend available");
}
