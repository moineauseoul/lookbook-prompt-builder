(function () {
  // ───────────────────────────────────────────────────────────
  // State
  // ───────────────────────────────────────────────────────────
  let presets = [];           // { id, name, front:{url,b64,mime}, side:{...}, desc }
  let selectedPresetIds = []; // for preset step (multi-select not required, kept simple)
  let baseImage = null;       // { url, b64, mime }
  let baseResultText = '';
  let confirmedBase = null;   // { text, hairPresetId, ratio }
  let cuts = [];              // { id, name, ratio, builtin, checked }
  let seriesResults = [];     // { cutId, name, text }

  const STORE_KEY = 'lookbook_pb_state_v1';
  const PRESET_KEY = 'lookbook_pb_presets_v1';

  const BUILTIN_CUTS = [
    { name: '전신컷 (세로형)', ratio: '3:4' },
    { name: '걸어가는 전신컷 측면', ratio: '4:3' },
    { name: '상반신 타이트컷', ratio: '3:4' },
    { name: '디테일 히어로컷', ratio: '1:1' },
    { name: '뒷모습 상반신 타이트컷', ratio: '3:4' },
    { name: '하반신 타이트컷', ratio: '3:4' }
  ];

  const MODELS = {
    claude: [
      { v: 'claude-sonnet-4-6', l: 'Sonnet 4.6 (권장)' },
      { v: 'claude-haiku-4-5-20251001', l: 'Haiku 4.5 (빠름)' },
      { v: 'claude-opus-4-8', l: 'Opus 4.8 (고성능)' }
    ],
    openai: [
      { v: 'gpt-4o', l: 'GPT-4o (권장)' },
      { v: 'gpt-4o-mini', l: 'GPT-4o mini (빠름)' }
    ]
  };

  // ───────────────────────────────────────────────────────────
  // DOM refs
  // ───────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  const apiToggleBtn = $('api-toggle-btn');
  const apiCard = $('api-card');
  const apiProvider = $('api-provider');
  const apiModel = $('api-model');
  const apiKeyEl = $('api-key');
  const saveKeyBtn = $('save-key-btn');
  const keyDot = $('key-dot');
  const keyStatus = $('key-status');

  const presetGrid = $('preset-grid');
  const presetAddBtn = $('preset-add-btn');

  const baseZone = $('base-zone');
  const baseFile = $('base-file');
  const baseZoneEmpty = $('base-zone-empty');
  const basePreview = $('base-preview');
  const baseHairSelect = $('base-hair-select');
  const baseRatioGroup = $('base-ratio-group');
  const baseNote = $('base-note');
  const extractBaseBtn = $('extract-base-btn');
  const baseLoading = $('base-loading');
  const baseError = $('base-error');
  const baseErrorMsg = $('base-error-msg');
  const baseResultWrap = $('base-result-wrap');
  const baseResultText_el = $('base-result-text');
  const baseCopyBtn = $('base-copy-btn');
  const baseCopyToast = $('base-copy-toast');
  const confirmBaseBtn = $('confirm-base-btn');

  const seriesEmpty = $('series-empty');
  const seriesContent = $('series-content');
  const seriesBaseSummary = $('series-base-summary');
  const editBaseBtn = $('edit-base-btn');
  const cutListEl = $('cut-list');
  const newCutName = $('new-cut-name');
  const addCutBtn = $('add-cut-btn');
  const generateSeriesBtn = $('generate-series-btn');
  const seriesLoading = $('series-loading');
  const seriesError = $('series-error');
  const seriesErrorMsg = $('series-error-msg');
  const seriesResultsEl = $('series-results');

  let activeBaseRatio = '3:4';

  // ───────────────────────────────────────────────────────────
  // Step tabs
  // ───────────────────────────────────────────────────────────
  document.querySelectorAll('.step-tab').forEach((tab) => {
    tab.addEventListener('click', () => goToStep(tab.dataset.step));
  });

  function goToStep(step) {
    document.querySelectorAll('.step-tab').forEach((t) => t.classList.toggle('active', t.dataset.step === step));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + step));
  }

  function markStepDone(step) {
    const tab = document.querySelector(`.step-tab[data-step="${step}"]`);
    if (tab) tab.classList.add('done');
  }

  // ───────────────────────────────────────────────────────────
  // API settings
  // ───────────────────────────────────────────────────────────
  apiToggleBtn.addEventListener('click', () => {
    apiCard.style.display = apiCard.style.display === 'none' ? 'block' : 'none';
  });

  function populateModels() {
    const provider = apiProvider.value;
    apiModel.innerHTML = '';
    MODELS[provider].forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.v; opt.textContent = m.l;
      apiModel.appendChild(opt);
    });
  }
  apiProvider.addEventListener('change', () => {
    populateModels();
    loadKeyForProvider();
  });
  populateModels();

  function loadKeyForProvider() {
    const provider = apiProvider.value;
    const key = localStorage.getItem('lpb_key_' + provider) || '';
    apiKeyEl.value = key;
    apiKeyEl.placeholder = provider === 'claude' ? 'sk-ant-...' : 'sk-...';
    updateKeyStatus();
  }

  function updateKeyStatus() {
    const has = !!apiKeyEl.value.trim();
    keyDot.classList.toggle('saved', has);
    keyStatus.textContent = has ? '저장됨' : '미입력';
  }

  saveKeyBtn.addEventListener('click', () => {
    const provider = apiProvider.value;
    localStorage.setItem('lpb_key_' + provider, apiKeyEl.value.trim());
    localStorage.setItem('lpb_provider', provider);
    localStorage.setItem('lpb_model_' + provider, apiModel.value);
    updateKeyStatus();
    saveKeyBtn.textContent = '저장됨 ✓';
    setTimeout(() => { saveKeyBtn.textContent = '저장'; }, 1500);
  });

  // restore provider/model prefs
  (function restoreApiPrefs() {
    const provider = localStorage.getItem('lpb_provider') || 'claude';
    apiProvider.value = provider;
    populateModels();
    const model = localStorage.getItem('lpb_model_' + provider);
    if (model) apiModel.value = model;
    loadKeyForProvider();
  })();

  // ───────────────────────────────────────────────────────────
  // Image helpers
  // ───────────────────────────────────────────────────────────
  function resizeImage(dataURL, maxPx, quality) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxPx || height > maxPx) {
          if (width >= height) { height = Math.round(height * maxPx / width); width = maxPx; }
          else { width = Math.round(width * maxPx / height); height = maxPx; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality || 0.85));
      };
      img.src = dataURL;
    });
  }

  function fileToResizedImage(file, maxPx, quality) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = async (ev) => {
        const resized = await resizeImage(ev.target.result, maxPx || 1200, quality || 0.85);
        const b64 = resized.split(',')[1];
        resolve({ url: resized, b64, mime: 'image/jpeg' });
      };
      r.readAsDataURL(file);
    });
  }

  // ───────────────────────────────────────────────────────────
  // Hair presets
  // ───────────────────────────────────────────────────────────
  function renderPresets() {
    presetGrid.querySelectorAll('.preset-card').forEach((el) => el.remove());
    presets.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'preset-card';
      card.innerHTML = `
        <button class="preset-del" data-id="${p.id}" title="삭제">✕</button>
        <div class="preset-thumbs">
          <img src="${p.front ? p.front.url : ''}" alt="정면">
          <img src="${p.side ? p.side.url : ''}" alt="측면">
        </div>
        <div class="preset-name">${esc(p.name)}</div>
      `;
      presetGrid.insertBefore(card, presetAddBtn);
    });
    presetGrid.querySelectorAll('.preset-del').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm('이 프리셋을 삭제할까요?')) return;
        presets = presets.filter((p) => p.id !== btn.dataset.id);
        savePresets();
        renderPresets();
        renderHairSelect();
      });
    });
    renderHairSelect();
  }

  function renderHairSelect() {
    baseHairSelect.innerHTML = '<option value="">선택 안 함</option>';
    presets.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      baseHairSelect.appendChild(opt);
    });
  }

  presetAddBtn.addEventListener('click', () => openPresetModal());

  function openPresetModal() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:1.6rem;max-width:420px;width:100%;">
        <div style="font-weight:700;font-size:.95rem;margin-bottom:1rem;">헤어 프리셋 추가</div>
        <label class="hint" style="display:block;margin-bottom:.3rem;">프리셋 이름</label>
        <input type="text" id="modal-preset-name" placeholder="예: 긴머리1" style="margin-bottom:1rem;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-bottom:1.2rem;">
          <div>
            <label class="hint" style="display:block;margin-bottom:.3rem;">정면 사진</label>
            <label class="upload-zone" style="min-height:100px;padding:.8rem;">
              <input type="file" accept="image/*" id="modal-front-file">
              <div id="modal-front-empty"><div class="ic" style="font-size:1rem;">📷</div><p style="font-size:.68rem;">정면</p></div>
              <img class="preview" id="modal-front-preview" style="display:none;max-height:90px;">
            </label>
          </div>
          <div>
            <label class="hint" style="display:block;margin-bottom:.3rem;">측면 사진</label>
            <label class="upload-zone" style="min-height:100px;padding:.8rem;">
              <input type="file" accept="image/*" id="modal-side-file">
              <div id="modal-side-empty"><div class="ic" style="font-size:1rem;">📷</div><p style="font-size:.68rem;">측면</p></div>
              <img class="preview" id="modal-side-preview" style="display:none;max-height:90px;">
            </label>
          </div>
        </div>
        <div id="modal-error" class="hint" style="color:#dc2626;margin-bottom:.6rem;display:none;"></div>
        <div style="display:flex;justify-content:flex-end;gap:.5rem;">
          <button class="btn-ghost btn-small" id="modal-cancel">취소</button>
          <button class="btn-primary btn-small" id="modal-save">추출 후 저장</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    let frontImg = null, sideImg = null;
    overlay.querySelector('#modal-front-file').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      frontImg = await fileToResizedImage(f, 900, 0.85);
      overlay.querySelector('#modal-front-empty').style.display = 'none';
      const prev = overlay.querySelector('#modal-front-preview');
      prev.src = frontImg.url; prev.style.display = 'block';
    });
    overlay.querySelector('#modal-side-file').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      sideImg = await fileToResizedImage(f, 900, 0.85);
      overlay.querySelector('#modal-side-empty').style.display = 'none';
      const prev = overlay.querySelector('#modal-side-preview');
      prev.src = sideImg.url; prev.style.display = 'block';
    });

    overlay.querySelector('#modal-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#modal-save').addEventListener('click', async () => {
      const name = overlay.querySelector('#modal-preset-name').value.trim();
      const errEl = overlay.querySelector('#modal-error');
      if (!name || !frontImg || !sideImg) {
        errEl.textContent = '이름과 정면/측면 사진을 모두 입력해주세요.';
        errEl.style.display = 'block';
        return;
      }
      const saveBtn = overlay.querySelector('#modal-save');
      saveBtn.disabled = true; saveBtn.textContent = '분석 중…';
      try {
        const desc = await analyzeHairPreset(frontImg, sideImg);
        presets.push({ id: Math.random().toString(36).slice(2), name, front: frontImg, side: sideImg, desc });
        savePresets();
        renderPresets();
        overlay.remove();
      } catch (e) {
        errEl.textContent = '오류: ' + e.message;
        errEl.style.display = 'block';
        saveBtn.disabled = false; saveBtn.textContent = '추출 후 저장';
      }
    });
  }

  async function analyzeHairPreset(frontImg, sideImg) {
    const prompt = `The two images are front and side references for one fixed hairstyle.

Reverse-engineer the hairstyle as a production lock for an image-generation prompt.
Do not merely describe what is visible.
Identify what must remain unchanged when the subject pose, camera angle, or scene changes.

Output in English only.
Use the exact format below and nothing else:

[HAIR]
Write 6-10 short lines describing the hairstyle.
Include hair color, parting, hairline behavior, volume level, texture, tied/untied structure, bun/ponytail/braid/etc. position, and any face-framing strands.

[HAIR LOCKS]
Write 4-8 short negative constraints that prevent the common wrong hairstyle.
Use direct phrases such as "This is NOT ...", "No ...", and "Do not create ...".
If the hair is a bun, explicitly forbid ponytail tails and hanging ends.
If the hair is loose, explicitly forbid tying it.

Do not mention facial identity, expression, age, ethnicity, clothing, lighting, or background.`;
    return callVisionAPI([frontImg, sideImg], prompt, true);
  }

  function savePresets() {
    try {
      localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
    } catch (e) {
      console.warn('프리셋 저장 실패 (용량 초과 가능):', e);
    }
  }
  function loadPresets() {
    try {
      const raw = localStorage.getItem(PRESET_KEY);
      if (raw) presets = JSON.parse(raw);
    } catch (e) { presets = []; }
  }

  // ───────────────────────────────────────────────────────────
  // Base cut: upload + ratio chips
  // ───────────────────────────────────────────────────────────
  baseFile.addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    baseImage = await fileToResizedImage(f, 1800, 0.9);
    baseZoneEmpty.style.display = 'none';
    basePreview.src = baseImage.url; basePreview.style.display = 'block';
    extractBaseBtn.disabled = false;
  });
  baseZone.addEventListener('dragover', (e) => { e.preventDefault(); baseZone.classList.add('drag'); });
  baseZone.addEventListener('dragleave', () => baseZone.classList.remove('drag'));
  baseZone.addEventListener('drop', async (e) => {
    e.preventDefault(); baseZone.classList.remove('drag');
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
    if (!f) return;
    baseImage = await fileToResizedImage(f, 1800, 0.9);
    baseZoneEmpty.style.display = 'none';
    basePreview.src = baseImage.url; basePreview.style.display = 'block';
    extractBaseBtn.disabled = false;
  });

  baseRatioGroup.querySelectorAll('.chip').forEach((c) => {
    c.addEventListener('click', () => {
      baseRatioGroup.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
      c.classList.add('active');
      activeBaseRatio = c.dataset.value;
    });
  });

  extractBaseBtn.addEventListener('click', async () => {
    if (!baseImage) return;
    const key = apiKeyEl.value.trim() || localStorage.getItem('lpb_key_' + apiProvider.value);
    if (!key) { alert('API 키를 먼저 입력해주세요 (우측 상단 API 설정).'); apiCard.style.display = 'block'; return; }

    baseResultWrap.style.display = 'none';
    baseError.style.display = 'none';
    baseLoading.style.display = 'block';
    extractBaseBtn.disabled = true;

    const hairId = baseHairSelect.value;
    const hairPreset = presets.find((p) => p.id === hairId);

    const prompt = buildBasePrompt(activeBaseRatio, baseNote.value.trim(), hairPreset);

    try {
      const text = await callVisionAPI([baseImage], prompt, false);
      baseResultText = text.trim();
      baseResultText_el.value = baseResultText;
      baseLoading.style.display = 'none';
      baseResultWrap.style.display = 'block';
      markStepDone('base');
    } catch (e) {
      baseLoading.style.display = 'none';
      baseError.style.display = 'block';
      baseErrorMsg.textContent = '오류: ' + e.message;
    } finally {
      extractBaseBtn.disabled = false;
    }
  });

  function buildBasePrompt(ratio, note, hairPreset) {
    const hairSection = hairPreset
      ? `Use this exact fixed hairstyle instead of the hairstyle in the reference image.
Copy the description into [HAIR] without weakening it.
If the saved preset already includes [HAIR LOCKS], copy those locks too.
If it does not include [HAIR LOCKS], infer 4-8 explicit negative locks from the saved hairstyle description to prevent the most likely wrong hairstyle.
For example, if the saved hairstyle is a low bun, forbid ponytails, hanging tails, loose ends, and glamorous volume.

${hairPreset.desc}`
      : `Extract the hairstyle from the reference image as a locked styling element.
Include structure, parting, volume, texture, tied/untied shape, and negative constraints that prevent likely wrong interpretations.`;
    const fixedOutfit = `Ignore the reference outfit.
Always dress the subject in a fixed ivory look:
- Ivory long-sleeve shirt.
- Clean shirt collar and simple shirt placket may be visible when the crop includes the neck.
- Sleeves must be full length and cover the wrists unless hands are visible.
- Ivory shorts with a clean minimal silhouette.
- The shorts are a styling requirement, not a framing requirement; do not widen the camera just to show the shorts.
- In tight portrait crops, the shorts may be outside the frame.
- No sweater, no knit pullover, no cardigan, no tank top, no trousers, no skirt, no dress.
- No logos, jewelry, belts, scarves, or extra accessories.`;

    let p = `You are not writing a caption.
You are reverse-engineering the reference image into an image-generation design blueprint.

FIRST, silently identify:
- What creates the mood of the image.
- What story moment is being photographed.
- Which elements must never change for the result to feel like the same lookbook image.
- Which elements are merely incidental and should stay quiet.

Then output the final prompt in English only.
Do not mention your analysis process.

CRITICAL PRIORITY ORDER:
1. Preserve the creative direction, emotion, and story moment.
2. Preserve the locked hairstyle exactly.
3. Preserve the reference camera framing, crop tightness, subject placement, and composition.
4. Preserve the bag height, bag scale, and hand/forearm relationship to the bag.
5. Force the fixed ivory long-sleeve shirt and ivory shorts outfit, regardless of the reference outfit.
6. Preserve the scene, lighting, color language, and textures.

LEFT/RIGHT RULE:
Use image left and image right from the viewer's perspective.
Before writing face direction, hand position, or bag position, check where the nose, gaze, shoulders, and bag sit in the image.
Do not mirror the image.

REFERENCE EXTRACTION RULES:
- Keep color language. Include clothing colors, bag color, wall/window/wood colors, skin tone only if needed for identity consistency, and overall palette.
- Keep texture language. Include knit, leather, plaster, wood, glass, foliage, film grain, softness, and surface finish when visible.
- Do not over-inventory the background. Describe only the scene elements that shape the mood or composition.
- Do not replace the photographed moment with a generic product pose.
- If the subject is looking down, away, or toward the bag, state that clearly.
- The bag must remain visually important and close to the torso. Preserve it as a substantial body-held object, not a small accessory.
- Describe the bag as occupying roughly 35-45% of the frame width when the reference composition supports a tight portrait.
- Preserve the vertical placement of the bag from the reference. If the reference bag rises to the upper chest, keep it high on the torso.
- Do not lower the bag to the waist or hip unless the reference does.
- Preserve the reference crop. Do not widen the image to show the outfit, shorts, legs, or more empty wall.
- If the reference is a tight upper-body portrait, keep the output as a tight upper-body portrait.
- If the bag is held close, hugged, supported, gripped, or resting against the body, state the exact relationship and make both arms support or cradle it.
- If the reference shows one hand resting flat across or just above the top handle, preserve that hand as a bag-contact gesture, not a face gesture.
- Hand-to-face gestures are prohibited unless the reference unmistakably shows actual contact with the mouth, lips, or chin.
- If the hand position is ambiguous, choose bag contact over face contact.
- Do not write "hand near mouth", "knuckles near lips", "fingers touching chin", or "contemplative hand-to-face gesture" unless the hand clearly touches the face in the reference.
- Prefer hands and forearms supporting, hugging, gripping, resting over, or wrapping around the bag.
- Avoid approximate numbers unless a numeric angle is genuinely useful. Prefer plain precise language over fake precision.
- Do not describe facial features, ethnicity, or age.
- Use negative locks for common generation failures, especially hairstyle, bag scale, pose, gaze, and framing.

OUTPUT FORMAT:
Use these exact section headers and order.
Write short prompt lines, not paragraphs.
Output nothing outside the sections.

[MASTER DIRECTION]
Define the image type, brand feeling, mood, and story moment.
Say what the image is really about, not just what objects are present.
Include "Single female subject only."

[HAIR]
${hairSection}

[OUTFIT]
${fixedOutfit}

[BAG]
If a bag is visible, describe the exact bag category, color, material finish, silhouette, handle/strap structure, and how it is held against the body.
Make the bag large enough to read as a key object in the image, not a small purse.
Preserve a substantial torso-held scale: the bag should cover a clear central area of the torso and occupy about 35-45% of the frame width in tight portraits.
Preserve the reference bag height. If the reference bag sits high against the chest and upper stomach, keep it there.
Describe the bag as hugged, cradled, supported from below, or held close to the chest/upper stomach when the reference supports that relationship.
If visible in the reference, keep one hand resting horizontally across or over the top handle while the opposite forearm supports the bottom of the bag.
Include hand placement and support points only when visible or when needed to prevent hand-to-face drift.
If no bag is visible, write: None.

[SCENE]
Describe the mood-setting location and composition.
Include only important structural elements, background depth, window/opening relationship, and environmental details.
Include colors and material textures when they are part of the atmosphere.

[CAMERA]
Aspect ratio: ${ratio}.
Describe framing, crop points, distance, lens feeling, angle, depth of field, subject placement, headroom, and how much of the body is visible.
Preserve the reference crop tightness exactly.
If the reference crop is upper-body only, do not widen to show shorts, thighs, full body, or extra wall.
If the bag is central in the lower half of the reference, keep the bag central and fully visible in the lower half.

[SUBJECT ACTION]
Describe the story moment, body direction, head tilt, gaze direction, expression, shoulders, arms, hands, and the subject's relationship to the bag.
Make the pose feel motivated, not mechanical.
Keep hands away from the mouth, lips, and chin unless the reference unmistakably shows contact.
When in doubt, place both hands/forearms on the bag: one supporting from below and one resting over or around the handle/body.
Preserve the reference hand architecture: one forearm beneath the bag, one hand resting flat over the top handle or upper edge when visible.
Do not convert the pose into a standing product-catalog hold with one arm hanging down.

[LIGHTING]
Describe light source, direction, softness, shadow contrast, highlights, and time-of-day feeling when visible.
Include color temperature only if it matters to the mood.

[COLOR & TEXTURE]
List the essential palette relationships and tactile qualities.
Explain the color harmony briefly through prompt lines.

[NEGATIVE LOCKS]
List what must not change.
Include hairstyle failures, wrong bag size/color/handling, wrong gaze, wrong pose, wrong crop, extra accessories, extra subjects, and over-styled editorial exaggeration.
Always include: no hand near mouth, no fingers touching lips, no chin-touch pose, no contemplative hand-to-face gesture.
Always include: do not shrink the bag, do not make it a small clutch, do not let it dangle from the handle, do not crop it out.
Always include: no outfit changes from the fixed ivory long-sleeve shirt and ivory shorts.
Always include: do not widen the crop to reveal shorts or legs when the reference is a tight portrait.
Always include: do not lower the bag to the waist, do not make one arm hang straight down, do not turn the pose into a catalog standing pose.
`;
    if (note) {
      p += `\nAdditional direction: ${note}\n`;
    }
    return p;
  }

  baseCopyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(baseResultText_el.value).catch(() => {});
    baseCopyToast.classList.add('show');
    setTimeout(() => baseCopyToast.classList.remove('show'), 1500);
  });

  confirmBaseBtn.addEventListener('click', () => {
    confirmedBase = {
      text: baseResultText_el.value.trim(),
      hairPresetId: baseHairSelect.value || null,
      ratio: activeBaseRatio
    };
    initCutsIfNeeded();
    renderSeriesPanel();
    goToStep('series');
  });

  editBaseBtn.addEventListener('click', () => goToStep('base'));

  // ───────────────────────────────────────────────────────────
  // Series step
  // ───────────────────────────────────────────────────────────
  function initCutsIfNeeded() {
    if (cuts.length) return;
    cuts = BUILTIN_CUTS.map((c) => ({
      id: Math.random().toString(36).slice(2),
      name: c.name,
      ratio: c.ratio,
      builtin: true,
      checked: true
    }));
  }

  function renderSeriesPanel() {
    if (!confirmedBase) {
      seriesEmpty.style.display = 'block';
      seriesContent.style.display = 'none';
      return;
    }
    seriesEmpty.style.display = 'none';
    seriesContent.style.display = 'block';

    const hairPreset = presets.find((p) => p.id === confirmedBase.hairPresetId);
    seriesBaseSummary.innerHTML = `
      <b>비율</b> ${esc(confirmedBase.ratio)} &nbsp;·&nbsp; <b>헤어</b> ${hairPreset ? esc(hairPreset.name) : '미지정'}<br>
      ${esc(confirmedBase.text).slice(0, 240)}${confirmedBase.text.length > 240 ? '…' : ''}
    `;

    renderCutList();
  }

  function renderCutList() {
    cutListEl.innerHTML = '';
    cuts.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'cut-row' + (c.builtin ? '' : ' custom');
      row.innerHTML = `
        <input type="checkbox" data-id="${c.id}" ${c.checked ? 'checked' : ''}>
        <span class="cut-name">${esc(c.name)}</span>
        <select class="cut-ratio-select" data-id="${c.id}" style="width:auto;padding:.3rem .5rem;font-size:.72rem;">
          <option value="3:4" ${c.ratio === '3:4' ? 'selected' : ''}>세로 3:4</option>
          <option value="4:3" ${c.ratio === '4:3' ? 'selected' : ''}>가로 4:3</option>
          <option value="9:16" ${c.ratio === '9:16' ? 'selected' : ''}>세로 9:16</option>
          <option value="1:1" ${c.ratio === '1:1' ? 'selected' : ''}>정방 1:1</option>
        </select>
        <button class="rm-cut" data-id="${c.id}" title="삭제">✕</button>
      `;
      cutListEl.appendChild(row);
    });
    cutListEl.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const c = cuts.find((x) => x.id === cb.dataset.id);
        if (c) c.checked = cb.checked;
      });
    });
    cutListEl.querySelectorAll('.cut-ratio-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const c = cuts.find((x) => x.id === sel.dataset.id);
        if (c) c.ratio = sel.value;
      });
    });
    cutListEl.querySelectorAll('.rm-cut').forEach((btn) => {
      btn.addEventListener('click', () => {
        cuts = cuts.filter((c) => c.id !== btn.dataset.id);
        renderCutList();
      });
    });
  }

  addCutBtn.addEventListener('click', () => {
    const name = newCutName.value.trim();
    if (!name) return;
    cuts.push({ id: Math.random().toString(36).slice(2), name, ratio: confirmedBase ? confirmedBase.ratio : '3:4', builtin: false, checked: true });
    newCutName.value = '';
    renderCutList();
  });
  newCutName.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCutBtn.click(); });

  generateSeriesBtn.addEventListener('click', async () => {
    const key = apiKeyEl.value.trim() || localStorage.getItem('lpb_key_' + apiProvider.value);
    if (!key) { alert('API 키를 먼저 입력해주세요.'); apiCard.style.display = 'block'; return; }
    const selected = cuts.filter((c) => c.checked);
    if (!selected.length) { alert('생성할 컷을 1개 이상 선택해주세요.'); return; }

    seriesError.style.display = 'none';
    seriesLoading.style.display = 'block';
    seriesResultsEl.innerHTML = '';
    generateSeriesBtn.disabled = true;

    try {
      const text = await callTextAPI(buildSeriesPrompt(selected));
      const parsed = parseSeriesResponse(text, selected);
      seriesResults = parsed;
      renderSeriesResults();
      markStepDone('series');
    } catch (e) {
      seriesError.style.display = 'block';
      seriesErrorMsg.textContent = '오류: ' + e.message;
    } finally {
      seriesLoading.style.display = 'none';
      generateSeriesBtn.disabled = false;
    }
  });

  function buildSeriesPrompt(selectedCuts) {
    const hairPreset = presets.find((p) => p.id === confirmedBase.hairPresetId);
    const hairSection = hairPreset ? hairPreset.desc : 'Not specified.';
    const fixedOutfit = 'Ivory long-sleeve shirt and ivory shorts only. Shorts are a styling requirement, not a framing requirement; do not widen tight crops just to show shorts. No sweater, no knit pullover, no cardigan, no tank top, no trousers, no skirt, no dress, no logos, no jewelry, no extra accessories.';
    const cutListText = selectedCuts.map((c, i) => `${i + 1}. ${c.name} (aspect ratio ${c.ratio})`).join('\n');

    return `Below is the confirmed base blueprint for a lookbook image:

"""
${confirmedBase.text}
"""

Generate individual cut prompts for the cuts listed below.
Each cut must feel like the same brand shoot, same reference atmosphere, and same design logic, but with a new camera/pose purpose.

Do not make a generic catalog pose.
Keep the quiet story moment, color language, texture, bag identity, outfit identity, and lighting behavior from the base.

FIXED ACROSS ALL CUTS:
- [MASTER DIRECTION]: preserve the base creative direction, emotion, and story moment.
- [HAIR]: use this exact fixed hairstyle and negative locks: "${hairSection}"
- [OUTFIT]: always use this fixed outfit: "${fixedOutfit}"
- [BAG]: preserve the base bag identity, color, material finish, substantial torso-held scale, high torso placement, and the feeling of how it is cradled or supported unless a cut is explicitly about no bag.
- [SCENE]: preserve the same location, atmosphere, color relationship, and mood-setting architectural/background elements.
- [LIGHTING]: preserve the same light source, softness, direction, contrast, and time-of-day feeling.
- [COLOR & TEXTURE]: preserve the base palette relationship and tactile qualities.
- [NEGATIVE LOCKS]: keep all relevant base locks and add cut-specific locks when needed.

VARIABLE PER CUT:
- [CAMERA]: change framing, crop, distance, angle, subject placement, and depth of field to match the cut name. Always begin with "Aspect ratio: X:X."
- [SUBJECT ACTION]: change body direction, gaze, hand/arm placement, and bag interaction to match the cut name while staying natural and motivated. Keep hands away from mouth, lips, and chin unless the base explicitly requires face contact. Preserve bag-contact hand architecture whenever the cut is a bag-focused crop.
- [BAG]: if the cut changes how the bag appears, describe the new grip/support/wear relationship precisely while preserving bag identity and substantial torso-held scale.

RULES:
- Use the exact section structure below for every cut:
  [MASTER DIRECTION], [HAIR], [OUTFIT], [BAG], [SCENE], [CAMERA], [SUBJECT ACTION], [LIGHTING], [COLOR & TEXTURE], [NEGATIVE LOCKS]
- Write in English only.
- Use short prompt lines.
- Do not mention facial features, ethnicity, or age.
- Do not add jewelry, extra accessories, extra furniture, extra people, logos, or editorial exaggeration unless present in the base.
- Do not create hand-to-face gestures, fingers touching lips, chin-touch poses, or a contemplative hand near the mouth.
- Do not shrink the bag into a small purse or clutch. Keep it visibly important and close to the body.
- Do not change the fixed ivory long-sleeve shirt and ivory shorts outfit.
- Do not widen tight portrait crops just to show shorts or legs.
- Do not lower the bag to the waist or turn the pose into a catalog hold.
- Use image left/image right from the viewer's perspective when describing direction.

컷 리스트:
${cutListText}

Respond ONLY with the following JSON (no markdown fences, no text outside the JSON):
{
  "cuts": [
    { "name": "컷 이름 그대로", "prompt": "[MASTER DIRECTION]\\n...\\n\\n[HAIR]\\n...\\n\\n[OUTFIT]\\n...\\n\\n[BAG]\\n...\\n\\n[SCENE]\\n...\\n\\n[CAMERA]\\nAspect ratio: X:X.\\n...\\n\\n[SUBJECT ACTION]\\n...\\n\\n[LIGHTING]\\n...\\n\\n[COLOR & TEXTURE]\\n...\\n\\n[NEGATIVE LOCKS]\\n..." }
  ]
}`;
  }

  function parseSeriesResponse(text, selectedCuts) {
    let txt = text.trim();
    const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) txt = fence[1].trim();
    let json;
    try { json = JSON.parse(txt); } catch (e) {
      throw new Error('응답 파싱에 실패했습니다. 다시 시도해주세요.');
    }
    const list = json.cuts || [];
    return selectedCuts.map((c) => {
      const match = list.find((x) => x.name === c.name) || list[selectedCuts.indexOf(c)] || {};
      return { cutId: c.id, name: c.name, ratio: c.ratio, text: (match.prompt || '').trim() };
    });
  }

  function renderSeriesResults() {
    seriesResultsEl.innerHTML = '';
    seriesResults.forEach((r, idx) => {
      const block = document.createElement('div');
      block.className = 'result-block';
      block.innerHTML = `
        <div class="result-head">
          <span class="result-title">${idx + 1}. ${esc(r.name)}</span>
          <div class="result-badges"><span class="badge">${esc(r.ratio)}</span></div>
        </div>
        <textarea class="result-text" data-idx="${idx}">${esc(r.text)}</textarea>
        <div class="result-actions">
          <span class="copy-toast" id="toast-${idx}">복사됨 ✓</span>
          <button class="btn-ghost btn-small copy-cut-btn" data-idx="${idx}">복사</button>
        </div>
      `;
      seriesResultsEl.appendChild(block);
    });
    seriesResultsEl.querySelectorAll('.copy-cut-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = btn.dataset.idx;
        const ta = seriesResultsEl.querySelector(`textarea[data-idx="${idx}"]`);
        navigator.clipboard.writeText(ta.value).catch(() => {});
        const toast = $('toast-' + idx);
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 1500);
      });
    });
  }

  // ───────────────────────────────────────────────────────────
  // API calls (Claude / OpenAI) — vision (image) & text-only
  // ───────────────────────────────────────────────────────────
  async function callVisionAPI(images, promptText, isHairAnalysis) {
    const provider = apiProvider.value;
    const key = apiKeyEl.value.trim() || localStorage.getItem('lpb_key_' + provider);
    const model = apiModel.value || (MODELS[provider][0].v);
    const maxTokens = isHairAnalysis ? 1200 : 3200;

    if (provider === 'claude') {
      const content = [];
      images.forEach((img, i) => {
        content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.b64 } });
      });
      content.push({ type: 'text', text: promptText });

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content }] })
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error?.message || `HTTP ${res.status}`);
      }
      const json = await res.json();
      return json.content[0].text;
    }

    // OpenAI
    const content = [{ type: 'text', text: promptText }];
    images.forEach((img) => {
      content.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.b64}` } });
    });
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content }] })
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error?.message || `HTTP ${res.status}`);
    }
    const json = await res.json();
    return json.choices[0].message.content;
  }

  async function callTextAPI(promptText) {
    const provider = apiProvider.value;
    const key = apiKeyEl.value.trim() || localStorage.getItem('lpb_key_' + provider);
    const model = apiModel.value || (MODELS[provider][0].v);
    const maxTokens = 5000;

    if (provider === 'claude') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: promptText }] })
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error?.message || `HTTP ${res.status}`);
      }
      const json = await res.json();
      return json.content[0].text;
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: promptText }] })
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error?.message || `HTTP ${res.status}`);
    }
    const json = await res.json();
    return json.choices[0].message.content;
  }

  // ───────────────────────────────────────────────────────────
  // utils
  // ───────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ───────────────────────────────────────────────────────────
  // init
  // ───────────────────────────────────────────────────────────
  loadPresets();
  renderPresets();
})();
