/**
 * NUMISTA MODAL FUNCTIONALITY
 *
 * Opens Numista coin database pages in a popup window.
 * Numista sets X-Frame-Options: SAMEORIGIN, so iframes are blocked
 * on hosted deployments. Popup windows work on both file:// and HTTP.
 */

/**
 * Opens the Numista page for the specified coin in a popup window.
 *
 * @param {string} numistaId - The Numista catalog ID
 * @param {string} coinName - The name of the coin (used for window title)
 */
function openNumistaModal(numistaId, coinName) {
  const rawId = String(numistaId || "").trim();
  if (!rawId) {
    appAlert("Preview unavailable: missing Numista catalog id.");
    return;
  }

  // Strip N# prefix first, THEN detect S for sets
  const stripped = rawId.replace(/^N#\s*/i, "").trim();
  const isSet = /^S/i.test(stripped);
  const cleanId = isSet ? stripped.replace(/^S/i, "").trim() : stripped;
  if (!/^\d+$/.test(cleanId)) {
    appAlert("Preview unavailable: invalid Numista catalog id.");
    return;
  }

  const url = isSet
    ? `https://en.numista.com/catalogue/set.php?id=${cleanId}`
    : `https://en.numista.com/catalogue/pieces${cleanId}.html`;

  const popup = window.open(
    url,
    `numista_${isSet ? "set_" : ""}${cleanId}`,
    "width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no"
  );

  if (!popup) {
    appAlert(`Popup blocked! Please allow popups or manually visit:\n${url}`);
  } else {
    popup.opener = null; // Security: prevent reverse tabnabbing
    popup.focus();
  }
}
