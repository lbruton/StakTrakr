"use strict";

/**
 * Shared image-frame editor (STRK-427, task A.2 scaffold).
 *
 * One component owns the presentation and state of image framing for both hosts, the
 * Add/Edit Item modal and the Edit Collection builder: the shape control, one orientation
 * control per side, the live-shaped preview frames, and the swap of per-side orientation.
 * It does no image I/O; hosts keep Upload, URL, Camera, Remove and persistence.
 *
 * Pure rules (derivation, reader, writer) live in js/image-frame.js. This file is the DOM
 * layer and loads immediately after it. Every method below throws until the implementation
 * task (C.3) replaces it, so the RED tests written before then fail for the right reason.
 *
 * Wrapped in an IIFE so no top-level name enters the shared script scope; the public surface
 * is `window.imageFrameEditor`.
 */
(() => {
  /**
   * Fail loudly for a method that has no implementation yet.
   * @param {string} method - Controller method name, for the stack trace only.
   * @returns {never}
   */
  const notImplemented = (method) => {
    const error = new Error("not implemented");
    error.method = method;
    throw error;
  };

  /**
   * @typedef {Object} ImageFrameEditorOptions
   * @property {"item"|"collection"} mode - Host kind; selects the persistence vocabulary.
   * @property {function(): Object} [getSignals] - Returns the current derivation signals
   *   (`type`, `gradingAuthority`, Numista shape).
   * @property {function(Object): void} [onChange] - Called with the new state after each change.
   */

  /**
   * @typedef {Object} ImageFrameEditorController
   * @property {function(Object): void} seed - Load a record's explicit signals and stored fields.
   * @property {function(): void} reset - Return to an empty, derived state.
   * @property {function(string): void} signalsChanged - A derivation signal changed
   *   (`type`, `grading` or `numista`); re-derive per the hybrid rule.
   * @property {function(): void} swapSides - Exchange per-side orientation; shape is untouched.
   * @property {function("obverse"|"reverse"): void} resetSide - Reset one side's orientation.
   * @property {function("obverse"|"reverse", boolean): void} setSideHasImage - Tell the editor
   *   whether a side currently holds an image.
   * @property {function(): Object} getState - Current shape, orientations and flags.
   * @property {function(): Object} getResult - Sparse fields to store plus keys to delete.
   * @property {function(): void} dispose - Remove listeners and DOM the editor created.
   * @property {function(function(Object): void): void} onChange - Register a change callback.
   */

  /**
   * Mount the editor into a host root that carries the `data-ife-*` slot hooks.
   * @param {HTMLElement} root - Host element containing the slot hooks.
   * @param {ImageFrameEditorOptions} options
   * @returns {ImageFrameEditorController}
   */
  const mount = (root, options) => {
    void root;
    void options;
    return {
      /**
       * Load a record's explicit signals and stored fields.
       * @param {Object} record
       */
      seed: (record) => {
        void record;
        notImplemented("seed");
      },
      /** Return to an empty, derived state. */
      reset: () => notImplemented("reset"),
      /**
       * A derivation signal changed; re-derive per the hybrid rule (D-5).
       * @param {string} kind - `type`, `grading` or `numista`.
       */
      signalsChanged: (kind) => {
        void kind;
        notImplemented("signalsChanged");
      },
      /** Exchange per-side orientation; the shape is untouched (AC-3.1). */
      swapSides: () => notImplemented("swapSides"),
      /**
       * Reset one side's orientation to its default (AC-3.3).
       * @param {"obverse"|"reverse"} side
       */
      resetSide: (side) => {
        void side;
        notImplemented("resetSide");
      },
      /**
       * Tell the editor whether a side currently holds an image.
       * @param {"obverse"|"reverse"} side
       * @param {boolean} hasImage
       */
      setSideHasImage: (side, hasImage) => {
        void side;
        void hasImage;
        notImplemented("setSideHasImage");
      },
      /**
       * Current shape, per-side orientation and flags.
       * @returns {Object}
       */
      getState: () => notImplemented("getState"),
      /**
       * Sparse fields to store plus the keys to delete (D-2, D-4).
       * @returns {{set: Object, remove: string[]}}
       */
      getResult: () => notImplemented("getResult"),
      /** Remove listeners and any DOM the editor created. */
      dispose: () => notImplemented("dispose"),
      /**
       * Register a change callback.
       * @param {function(Object): void} callback
       */
      onChange: (callback) => {
        void callback;
        notImplemented("onChange");
      },
    };
  };

  if (typeof window !== "undefined") {
    window.imageFrameEditor = { mount };
  }
})();
