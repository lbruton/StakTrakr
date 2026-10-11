"use strict";

/**
 * Shared image-frame editor (STRK-427).
 *
 * One component owns the presentation and state of image framing for both hosts, the
 * Add/Edit Item modal and the Edit Collection builder: the shape control, one orientation
 * control per side, the live-shaped preview frames, and the swap of per-side orientation.
 * It does no image I/O; hosts keep Upload, URL, Camera, Remove and persistence.
 *
 * Slot contract (a missing required slot throws, there is no fallback layout):
 *
 *   [data-ife-shape]                   required, receives the "Image shape" radiogroup
 *   [data-ife-frame="obverse|reverse"] required, the preview frame; the editor sets
 *                                      data-shape, data-orientation and .has-image on it
 *   [data-ife-orientation="obverse|reverse"]
 *                                      required, receives that side's orientation radiogroup,
 *                                      hidden while the shape does not rotate
 *   [data-ife-swap]                    optional, shown only while both sides hold an image
 *
 * Pure rules (derive, reader, writer) live in js/image-frame.js, which loads before this file.
 * Wrapped in an IIFE so no top-level name enters the shared script scope; the public surface
 * is `window.imageFrameEditor`.
 */
(() => {
  const SIDES = ["obverse", "reverse"];
  const SIDE_LABELS = { obverse: "Obverse", reverse: "Reverse" };
  // [value, visible label, glyph parts]; a glyph part is [svg tag, attributes].
  const SHAPE_OPTIONS = [
    ["round", "Round", [["circle", { cx: 12, cy: 12, r: 8 }]]],
    ["bar", "Bar", [["rect", { x: 8, y: 3, width: 8, height: 18, rx: 1.5 }]]],
    ["note", "Note", [["rect", { x: 3, y: 8, width: 18, height: 8, rx: 1.5 }]]],
    [
      "slab",
      "Slab",
      [
        ["rect", { x: 6, y: 3, width: 12, height: 18, rx: 2 }],
        ["rect", { x: 9, y: 7, width: 6, height: 6, rx: 3 }],
      ],
    ],
  ];
  const ORIENTATION_OPTIONS = [
    ["portrait", "Portrait", [["rect", { x: 7, y: 3, width: 10, height: 18, rx: 1.5 }]]],
    ["landscape", "Landscape", [["rect", { x: 3, y: 7, width: 18, height: 10, rx: 1.5 }]]],
  ];
  let mountCount = 0;

  /**
   * @typedef {Object} ImageFrameSignals
   * @property {string} [type] - Item type
   * @property {string} [gradingAuthority] - Grading authority, when graded
   * @property {string} [numistaShape] - Raw Numista shape text
   */

  /**
   * @typedef {Object} ImageFrameEditorOptions
   * @property {function(): ImageFrameSignals} [getSignals] - Reads the host's current derivation
   *   signals; called at change time, never cached.
   * @property {function(Object): void} [onChange] - Called with the new state after each change.
   */

  /**
   * @typedef {Object} ImageFrameEditorState
   * @property {string} shape - "round" | "bar" | "note" | "slab"
   * @property {boolean} shapeChosen - True once the user (or a stored value) chose the shape
   * @property {string|null} obverseOrientation - Null while the shape does not rotate
   * @property {string|null} reverseOrientation - Null while the shape does not rotate
   * @property {{obverse: boolean, reverse: boolean}} hasImage - Per-side image presence
   */

  /**
   * Build an element with an optional class and text.
   * @param {string} tag
   * @param {string} [className]
   * @param {string} [text]
   * @returns {HTMLElement}
   */
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const SVG_NS = "http://www.w3.org/2000/svg";

  /**
   * Build a small decorative SVG glyph from [tag, attributes] parts.
   * @param {Array<[string, Object]>} parts
   * @returns {SVGElement}
   */
  const glyph = (parts) => {
    const svg = document.createElementNS(SVG_NS, "svg");
    const attributes = {
      width: "16",
      height: "16",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    };
    Object.entries(attributes).forEach(([name, value]) => svg.setAttribute(name, value));
    parts.forEach(([tag, attrs]) => {
      const part = document.createElementNS(SVG_NS, tag);
      Object.entries(attrs).forEach(([name, value]) => part.setAttribute(name, String(value)));
      svg.append(part);
    });
    return svg;
  };

  /**
   * Build a captioned segmented radiogroup with the shared `.collections-segmented` look.
   * @param {string} caption - Visible group label (also the accessible name)
   * @param {string} name - Radio group name
   * @param {string} idBase - Unique id prefix for the caption
   * @param {Array<[string, string, Array]>} options - [value, label, glyph parts]
   * @returns {{node: HTMLElement, inputs: HTMLInputElement[]}}
   */
  const radioGroup = (caption, name, idBase, options) => {
    const wrap = make("div", "ife-group");
    const cap = make("span", "ife-cap", caption);
    cap.id = idBase;
    const group = make("div", "collections-segmented");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-labelledby", idBase);
    const inputs = options.map(([value, label, inner]) => {
      const option = make("label", "collections-segmented-option");
      const input = make("input");
      input.type = "radio";
      input.name = name;
      input.value = value;
      const face = make("span");
      face.append(glyph(inner), document.createTextNode(label));
      option.append(input, face);
      group.append(option);
      return input;
    });
    wrap.append(cap, group);
    return { node: wrap, inputs };
  };

  /**
   * Mount the editor into a host root that carries the `data-ife-*` slot hooks.
   * @param {HTMLElement} root - Host element containing the slot hooks.
   * @param {ImageFrameEditorOptions} [options]
   * @returns {Object} The controller: seed, reset, signalsChanged, swapSides, resetSide,
   *   setSideHasImage, getState, getResult, dispose, onChange.
   */
  const mount = (root, options = {}) => {
    if (!(root instanceof HTMLElement))
      throw new Error("image-frame-editor: a root element is required");
    const frameRules = window;
    ["deriveImageShape", "defaultImageOrientation", "writeImageFraming"].forEach((name) => {
      if (typeof frameRules[name] !== "function") {
        throw new Error(`image-frame-editor: js/image-frame.js must load first (${name})`);
      }
    });
    /**
     * Find one required slot or throw.
     * @param {string} selector
     * @returns {HTMLElement}
     */
    const requireSlot = (selector) => {
      const node = root.querySelector(selector);
      if (!node) throw new Error(`image-frame-editor: missing slot ${selector}`);
      return node;
    };
    const uid = ++mountCount;
    const shapeSlot = requireSlot("[data-ife-shape]");
    const frames = {};
    const orientationSlots = {};
    SIDES.forEach((side) => {
      frames[side] = requireSlot(`[data-ife-frame="${side}"]`);
      orientationSlots[side] = requireSlot(`[data-ife-orientation="${side}"]`);
    });
    const swapSlot = root.querySelector("[data-ife-swap]");
    const listeners = [];
    if (typeof options.onChange === "function") listeners.push(options.onChange);

    const state = {
      shape: "round",
      shapeChosen: false,
      orientation: { obverse: null, reverse: null },
      hasImage: { obverse: false, reverse: false },
    };
    let previousDerived = "round";

    /**
     * The host's current derivation signals.
     * @returns {ImageFrameSignals}
     */
    const currentSignals = () => {
      const signals = typeof options.getSignals === "function" ? options.getSignals() : null;
      return signals && typeof signals === "object" ? signals : {};
    };
    /**
     * Derive the shape for a set of signals.
     * @param {ImageFrameSignals} signals
     * @returns {string}
     */
    const derive = (signals) => window.deriveImageShape(signals);
    /**
     * The orientation a shape starts with, for both sides.
     * @param {string} shape
     * @returns {{obverse: string|null, reverse: string|null}}
     */
    const defaultOrientation = (shape) => {
      const value = window.defaultImageOrientation(shape);
      return { obverse: value, reverse: value };
    };

    // ---- DOM ------------------------------------------------------------------------
    root.classList.add("ife");
    shapeSlot.replaceChildren();
    const shapeGroup = radioGroup(
      "Image shape",
      `ife-shape-${uid}`,
      `ife-shape-cap-${uid}`,
      SHAPE_OPTIONS
    );
    shapeSlot.append(shapeGroup.node);
    const orientationInputs = {};
    SIDES.forEach((side) => {
      frames[side].classList.add("ife-frame");
      orientationSlots[side].replaceChildren();
      const group = radioGroup(
        `${SIDE_LABELS[side]} orientation`,
        `ife-${side}-orientation-${uid}`,
        `ife-${side}-cap-${uid}`,
        ORIENTATION_OPTIONS
      );
      orientationSlots[side].append(group.node);
      orientationInputs[side] = group.inputs;
    });

    // ---- State -> DOM ----------------------------------------------------------------
    /** Reflect the state into the radios, frame attributes, orientation slots and swap slot. */
    const paint = () => {
      shapeGroup.inputs.forEach((input) => {
        input.checked = input.value === state.shape;
      });
      const rotates = Boolean(window.defaultImageOrientation(state.shape));
      SIDES.forEach((side) => {
        const frame = frames[side];
        frame.dataset.shape = state.shape;
        if (rotates && state.orientation[side]) frame.dataset.orientation = state.orientation[side];
        else delete frame.dataset.orientation;
        frame.classList.toggle("has-image", state.hasImage[side]);
        orientationSlots[side].hidden = !rotates;
        orientationInputs[side].forEach((input) => {
          input.checked = rotates && input.value === state.orientation[side];
        });
      });
      if (swapSlot) {
        const visible = state.hasImage.obverse && state.hasImage.reverse;
        swapSlot.hidden = !visible;
        swapSlot.classList.toggle("d-none", !visible);
      }
    };

    /**
     * A snapshot of the state for callers.
     * @returns {ImageFrameEditorState}
     */
    const getState = () => ({
      shape: state.shape,
      shapeChosen: state.shapeChosen,
      obverseOrientation: state.orientation.obverse,
      reverseOrientation: state.orientation.reverse,
      hasImage: { ...state.hasImage },
    });

    /** Repaint and tell every listener the state changed. */
    const commit = () => {
      paint();
      const snapshot = getState();
      listeners.forEach((listener) => listener(snapshot));
    };

    /**
     * Move to a shape. A real shape change restarts both sides at that shape's default
     * orientation (AC-4.8); re-deriving to the same shape keeps the orientation.
     * @param {string} shape
     * @param {boolean} chosen - True when the user picked it
     */
    const applyShape = (shape, chosen) => {
      if (shape !== state.shape) {
        state.shape = shape;
        state.orientation = defaultOrientation(shape);
      }
      if (chosen) state.shapeChosen = true;
    };

    // ---- Controller ------------------------------------------------------------------
    /**
     * Load a record's explicit signals and stored choices. Signals are passed in rather than
     * read from the DOM because Numista fields fill after the host seeds (D-6).
     * @param {{signals?: ImageFrameSignals, shape?: string, shapeChosen?: boolean,
     *   orientation?: {obverse?: string, reverse?: string},
     *   hasImage?: {obverse?: boolean, reverse?: boolean}}} [input]
     */
    const seed = (input = {}) => {
      const signals = input.signals || currentSignals();
      previousDerived = derive(signals);
      state.shape = ["round", "bar", "note", "slab"].includes(input.shape)
        ? input.shape
        : previousDerived;
      state.shapeChosen = Boolean(input.shapeChosen);
      const fallback = defaultOrientation(state.shape);
      const given = input.orientation || {};
      const pick = (side) =>
        fallback[side] && ["portrait", "landscape"].includes(given[side])
          ? given[side]
          : fallback[side];
      state.orientation = { obverse: pick("obverse"), reverse: pick("reverse") };
      state.hasImage = {
        obverse: Boolean(input.hasImage && input.hasImage.obverse),
        reverse: Boolean(input.hasImage && input.hasImage.reverse),
      };
      commit();
    };

    /** Return to an empty, derived state from the host's current signals. */
    const reset = () => seed({});

    /**
     * A derivation signal changed (D-5). A Type change re-derives only while the shape still
     * equals what the previous signals derived; grading and Numista changes re-derive only
     * while the user has not chosen a shape.
     * @param {string} kind - "type", "grading" or "numista"
     */
    const signalsChanged = (kind) => {
      const next = derive(currentSignals());
      // A call that derives the same shape is a no-op (D-6): the host also notifies at
      // edit-open and prefill, and that must not move a legacy or pinned shape.
      if (next === previousDerived) return;
      if (kind === "type") {
        if (state.shape === previousDerived) applyShape(next, false);
      } else if (!state.shapeChosen) {
        applyShape(next, false);
      }
      previousDerived = next;
      commit();
    };

    /** Exchange per-side orientation; the shared shape is untouched (AC-3.1). */
    const swapSides = () => {
      const { obverse, reverse } = state.orientation;
      state.orientation = { obverse: reverse, reverse: obverse };
      commit();
    };

    /**
     * Reset one side's orientation to its default and keep the shape (AC-3.3).
     * @param {"obverse"|"reverse"} side
     */
    const resetSide = (side) => {
      if (!SIDES.includes(side)) return;
      state.orientation[side] = window.defaultImageOrientation(state.shape);
      commit();
    };

    /**
     * Tell the editor whether a side holds an image; this alone drives Swap visibility.
     * @param {"obverse"|"reverse"} side
     * @param {boolean} hasImage
     */
    const setSideHasImage = (side, hasImage) => {
      if (!SIDES.includes(side)) return;
      state.hasImage[side] = Boolean(hasImage);
      commit();
    };

    /**
     * The sparse item fields to store, and the keys to delete (D-2, D-4).
     * @returns {{set: Object, remove: string[]}}
     */
    const getResult = () =>
      window.writeImageFraming(
        {
          shape: state.shape,
          obverseOrientation: state.orientation.obverse,
          reverseOrientation: state.orientation.reverse,
        },
        currentSignals()
      );

    // ---- User input ------------------------------------------------------------------
    /**
     * Handle a change on one of the editor's own radios.
     * @param {Event} event
     */
    const onChange = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "radio") return;
      if (shapeGroup.inputs.includes(target)) {
        applyShape(target.value, true);
        commit();
        return;
      }
      const side = SIDES.find((name) => orientationInputs[name].includes(target));
      if (side) {
        state.orientation[side] = target.value;
        commit();
      }
    };
    /**
     * Clicking a shape pins it even when it is already the selected one: a radio fires no
     * `change` for that, but the user did choose it (AC-4.5).
     * @param {Event} event
     */
    const onClick = (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && shapeGroup.inputs.includes(target)) {
        applyShape(target.value, true);
        commit();
      }
    };
    root.addEventListener("change", onChange);
    root.addEventListener("click", onClick);

    /** Remove listeners and every node and attribute the editor added. */
    const dispose = () => {
      root.removeEventListener("change", onChange);
      root.removeEventListener("click", onClick);
      shapeSlot.replaceChildren();
      SIDES.forEach((side) => {
        orientationSlots[side].replaceChildren();
        frames[side].classList.remove("ife-frame", "has-image");
        delete frames[side].dataset.shape;
        delete frames[side].dataset.orientation;
      });
      root.classList.remove("ife");
      listeners.length = 0;
    };

    seed({});
    return {
      seed,
      reset,
      signalsChanged,
      swapSides,
      resetSide,
      setSideHasImage,
      getState,
      getResult,
      dispose,
      /**
       * Register a change callback.
       * @param {function(Object): void} callback
       */
      onChange: (callback) => {
        if (typeof callback === "function") listeners.push(callback);
      },
    };
  };

  /**
   * Adapter for the Add/Edit Item modal. It owns the item-specific glue around one mounted
   * editor: seeding from a stored record, the edit-save gate, and presence/swap forwarding. The
   * host (events.js) supplies only DOM reads, so its own file stays small.
   * @param {{root: function(): (HTMLElement|null), readSignals: function(): ImageFrameSignals}} config
   * @returns {Object} mount, isMounted, seed, reset, notify, collect, setPresence, swapSides, resetSide
   */
  const createItemHost = (config) => {
    let controller = null;
    let seedSnapshot = null;

    /**
     * Remember the editor's state right after a seed or reset, for the edit-save gate (D-4).
     * @param {ImageFrameSignals} signals - The signals the state was derived from
     */
    const snapshot = (signals) => {
      if (!controller) {
        seedSnapshot = null;
        return;
      }
      const state = controller.getState();
      seedSnapshot = {
        shape: state.shape,
        obverse: state.obverseOrientation,
        reverse: state.reverseOrientation,
        derived: window.deriveImageShape(signals),
      };
    };

    return {
      /** Mount the editor into the host root, once. Failure leaves the host unmounted. */
      mount: () => {
        if (controller) return;
        const root = config.root();
        if (!root) return;
        try {
          controller = mount(root, { getSignals: config.readSignals });
          snapshot(config.readSignals());
        } catch (error) {
          controller = null;
          console.warn("[image-frame-editor] failed to mount:", error.message);
        }
      },
      isMounted: () => Boolean(controller),
      /**
       * Seed from a stored item (edit and clone). Signals are explicit because the Numista
       * fields fill after the seed (D-6); a valid stored imageShape marks the shape chosen.
       * @param {Object} item - The inventory item being edited or cloned
       */
      seed: (item) => {
        if (!controller) return;
        const record = item || {};
        const framing = window.readImageFraming(record);
        const signals = {
          type: record.type || "",
          gradingAuthority: record.gradingAuthority || "",
          numistaShape: record.numistaData?.shape || "",
        };
        controller.seed({
          signals,
          shape: framing.shape,
          shapeChosen: Boolean(window.normalizeImageShape(record.imageShape)),
          orientation: { obverse: framing.obverseOrientation, reverse: framing.reverseOrientation },
        });
        snapshot(signals);
      },
      /** Reset to an empty, derived state (a fresh add, or the start of every edit). */
      reset: () => {
        if (!controller) return;
        controller.reset();
        snapshot(config.readSignals());
      },
      /**
       * A derivation signal changed.
       * @param {"type"|"grading"|"numista"} kind
       */
      notify: (kind) => {
        if (controller) controller.signalsChanged(kind);
      },
      /**
       * The frame fields to write for this save, or null to leave the stored ones untouched. An
       * add or clone always applies the writer; an edit applies it only when the user changed
       * the framing or a derivation signal moved the derived default, so an untouched edit
       * keeps a legacy mixed circle/rectangle pair byte-identical (D-4, AC-8.5).
       * @param {boolean} isEditing - True for an edit of an existing item
       * @returns {{set: Object, remove: string[]}|null}
       */
      collect: (isEditing) => {
        if (!controller) return null;
        const result = controller.getResult();
        if (!isEditing) return result;
        const state = controller.getState();
        const seeded = seedSnapshot;
        const dirty =
          !seeded ||
          state.shape !== seeded.shape ||
          state.obverseOrientation !== seeded.obverse ||
          state.reverseOrientation !== seeded.reverse;
        const signalsMoved =
          !seeded || window.deriveImageShape(config.readSignals()) !== seeded.derived;
        return dirty || signalsMoved ? result : null;
      },
      /**
       * Tell the editor which sides currently hold an image.
       * @param {boolean} obverse
       * @param {boolean} reverse
       */
      setPresence: (obverse, reverse) => {
        if (!controller) return;
        controller.setSideHasImage("obverse", obverse);
        controller.setSideHasImage("reverse", reverse);
      },
      /** Exchange per-side orientation after the host swapped the images. */
      swapSides: () => {
        if (controller) controller.swapSides();
      },
      /**
       * Reset one side's orientation after the host removed its image.
       * @param {"obverse"|"reverse"} side
       */
      resetSide: (side) => {
        if (controller) controller.resetSide(side);
      },
    };
  };

  if (typeof window !== "undefined") {
    window.imageFrameEditor = { mount, createItemHost };
  }
})();
