/**
 * @file types.js - JSDoc Type Definitions for StakTrakr
 * This file contains only JSDoc comments for core data structures.
 * It is not loaded at runtime but provides IDE support and documentation.
 */

/**
 * @typedef {Object} InventoryItem
 * @property {string} metal - Metal type (Silver, Gold, Platinum, Palladium, Copper)
 * @property {string} [composition] - Composition (Gold, Silver, Platinum, Palladium, Copper, Alloy)
 * @property {string} name - Display name of the item
 * @property {number} qty - Quantity of items
 * @property {string} type - Item type (Coin, Round, Bar, etc.)
 * @property {number} weight - Weight per item
 * @property {string} [weightUnit] - Weight unit (oz, g, kg, avdp, etc.)
 * @property {number} [purity] - Purity (0.0 to 1.0)
 * @property {number} price - Purchase price per item
 * @property {string} date - Purchase date (YYYY-MM-DD)
 * @property {string} [purchaseLocation] - Where the item was purchased
 * @property {string} [storageLocation] - Where the item is stored
 * @property {string} [notes] - User notes
 * @property {number} [spotPriceAtPurchase] - Spot price at time of purchase
 * @property {number} [premiumPerOz] - Premium paid per ounce
 * @property {number} [totalPremium] - Total premium paid for all units
 * @property {number} [marketValue] - Current market value (calculated or manual override)
 * @property {string} [numistaId] - Numista ID for lookup
 * @property {string} [year] - Year of issue
 * @property {string} [grade] - Item grade
 * @property {string} [gradingAuthority] - Grading authority (PCGS, NGC, etc.)
 * @property {string} [certNumber] - Certification number
 * @property {string} [serialNumber] - Serial number
 * @property {string} [pcgsNumber] - PCGS number for lookup
 * @property {boolean} [pcgsVerified] - Whether PCGS data has been verified
 * @property {string} [serial] - Original serial number string from import
 * @property {string} uuid - Unique identifier for the item
 * @property {string} [obverseImageUrl] - URL for obverse image
 * @property {string} [reverseImageUrl] - URL for reverse image
 * @property {"auto"|"circle"|"rectangle"} [obverseImageFrame] - Optional obverse image frame override
 * @property {"auto"|"circle"|"rectangle"} [reverseImageFrame] - Optional reverse image frame override
 * @property {string|null} [obverseSharedImageId] - UUID of source item if obverse image was tagged from the shared library (null for original uploads)
 * @property {string|null} [reverseSharedImageId] - UUID of source item if reverse image was tagged from the shared library (null for original uploads)
 * @property {string|null} [tradedFromUuid] - UUID of the disposed item that was traded to acquire this item
 * @property {boolean} [collectable] - Whether item is marked as collectable
 * @property {AttachmentEntry[]} [attachments] - Per-item file attachments (STRK-45)
 * @property {Object} [disposition] - Disposition details for removed or disposed items
 * @property {string[]} [disposition.tradedForUuids] - UUIDs of inventory items received in this trade
 * @property {Object.<string, {meltValue: number, spotPrice: number, isCustom: boolean}>} [disposition.tradeValues] - Trade value snapshots keyed by received item UUID
 */

/**
 * @typedef {Object} SpotHistoryEntry
 * @property {number} spot - Spot price
 * @property {string} metal - Metal name (Gold, Silver, Platinum, Palladium)
 * @property {string} source - Data source (e.g., 'seed', 'api')
 * @property {string} provider - Data provider (e.g., 'LBMA', 'Metals.dev')
 * @property {string} timestamp - UTC timestamp (YYYY-MM-DD HH:mm:ss or ISO)
 */

/**
 * @typedef {Object} ApiProviderConfig
 * @property {string} name - Display name for the provider
 * @property {string} baseUrl - Base API endpoint URL
 * @property {Object<string, string>} endpoints - API endpoints for different metals
 * @property {function} parseResponse - Function to parse API response into standard format
 * @property {string} documentation - URL to provider's API documentation
 * @property {boolean} batchSupported - Whether provider supports batch requests
 * @property {string} [batchEndpoint] - Batch request endpoint pattern
 * @property {function} [parseBatchResponse] - Function to parse batch API response
 * @property {boolean} [requiresKey] - Whether an API key is required
 */

/**
 * @typedef {Object} ApiConfig
 * @property {string} provider - Currently selected provider key
 * @property {Object<string, string>} keys - API keys for different providers
 * @property {Object} [usage] - Usage tracking
 */

/**
 * @typedef {Object} CsvMappingRules
 * @property {Object<string, string>} columnMap - Mapping of CSV columns to internal item properties
 * @property {string[]} [ignoredColumns] - Columns to ignore during import
 */

/**
 * @typedef {Object} FilterConfig
 * @property {string} [metal] - Metal filter
 * @property {string} [type] - Type filter
 * @property {string} [search] - Search query
 */

/**
 * @typedef {Object} DomElements
 * @property {Object} spotPriceDisplay - Spot price display elements
 * @property {Object} spotSyncIcon - Spot sync icon elements
 * @property {HTMLElement} inventoryForm - Main inventory form
 * @property {HTMLElement} inventoryTable - Main inventory table
 * @property {HTMLElement} itemMetal - Metal select field
 * @property {HTMLElement} itemName - Name input field
 * @property {HTMLElement} itemQty - Quantity input field
 * @property {HTMLElement} itemType - Type input field
 * @property {HTMLElement} itemWeight - Weight input field
 * @property {HTMLElement} itemWeightUnit - Weight unit select field
 * @property {HTMLElement} itemPrice - Price input field
 * @property {HTMLElement} itemDate - Date input field
 * @property {HTMLElement} searchInput - Search input field
 * @property {HTMLElement} typeFilter - Type filter select field
 * @property {HTMLElement} metalFilter - Metal filter select field
 * @property {Object} totals - Totals display elements organized by metal
 */

// =============================================================================
// STRK-45: Per-item attachment type definitions
// =============================================================================

/**
 * Attachment entry stored on an inventory item record (metadata only — no blob).
 * @typedef {Object} AttachmentEntry
 * @property {string} attachmentUuid - UUID v4 identifying this attachment
 * @property {string} fileName - Original filename (e.g. "receipt-2024.pdf")
 * @property {string} type - MIME type (e.g. "application/pdf", "image/png", "image/jpeg")
 * @property {number} size - File size in bytes
 * @property {string} uploadedAt - ISO 8601 timestamp of when the attachment was added
 */

/**
 * Full attachment record stored in the IndexedDB `userAttachments` store.
 * Extends AttachmentEntry with the parent item link and the binary blob.
 * @typedef {Object} AttachmentRecord
 * @property {string} attachmentUuid - UUID v4 (keyPath for the IDB store)
 * @property {string} itemUuid - UUID of the parent inventory item
 * @property {string} fileName - Original filename
 * @property {string} type - MIME type
 * @property {number} size - File size in bytes
 * @property {string} uploadedAt - ISO 8601 timestamp
 * @property {Blob} blob - The file binary
 */

/**
 * Entry in `user_attachment_manifest.json` inside a zip backup.
 * Extends AttachmentRecord metadata with the stored file path inside the zip.
 * @typedef {Object} AttachmentManifestEntry
 * @property {string} attachmentUuid - UUID v4
 * @property {string} itemUuid - UUID of the parent inventory item
 * @property {string} file - Path inside the zip (e.g. "user_attachments/{uuid}.pdf")
 * @property {string} fileName - Original filename
 * @property {string} type - MIME type
 * @property {number} size - File size in bytes
 * @property {string} uploadedAt - ISO 8601 timestamp
 */
