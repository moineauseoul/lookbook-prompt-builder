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
    const prompt = `위 두 장의 이미지(정면, 측면)는 같은 인물의 헤어스타일 레퍼런스입니다. 이 헤어스타일을 영문으로 상세하게 묘사하는 한 문단을 작성해주세요. 머리 길이, 컬러, 질감(웨이브/스트레이트), 스타일링 방식(묶음/로우번/풀어헤침 등), 가르마 위치만 포함하고 인물의 얼굴 생김새나 표정은 언급하지 마세요. 마크다운 없이 영문 설명 문장만 출력하세요.`;
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
    baseImage = await fileToResizedImage(f, 1400, 0.85);
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
    baseImage = await fileToResizedImage(f, 1400, 0.85);
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
    let p = `위 레퍼런스 이미지를 분석해서 AI 이미지 생성용 영문 프롬프트를 작성해주세요.

다음 항목만 포함하세요:
- 배경 (장소, 환경, 시간대, 빛의 느낌)
- 인물의 포즈 (자세, 손/팔의 위치, 몸의 방향)
- 인물의 표정
- 인물의 시선 방향
- 카메라 구도 (앵글, 거리감)
- 프레이밍과 크롭 위치 (인물의 어느 부위에서 잘리는지)
- 실루엣 비율 (인물이 프레임 내에서 차지하는 비중)
- 전체적인 무드와 톤 (필름톤, 자연광 등)

다음은 절대 포함하지 마세요:
- 의류/제품에 대한 묘사 (옷 색상, 디자인, 소재 등)
- 인물의 얼굴 생김새, 나이, 인종에 대한 묘사
- 헤어스타일 (별도로 지정됨)

이미지 비율: ${ratio}
`;
    if (hairPreset) {
      p += `\n인물의 헤어스타일은 다음과 같이 고정해서 프롬프트에 포함해주세요: ${hairPreset.desc}\n`;
    }
    if (note) {
      p += `\n추가 요청사항: ${note}\n`;
    }
    p += `\n마크다운 없이, 영문 프롬프트 문단만 출력하세요. (이미지 비율 표기는 "Aspect ratio: ${ratio}" 형태로 마지막 줄에 포함)`;
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
    const cutListText = selectedCuts.map((c, i) => `${i + 1}. ${c.name} (비율 ${c.ratio})`).join('\n');

    return `아래는 룩북 촬영의 베이스 컨셉(배경/분위기) 프롬프트입니다:

"""
${confirmedBase.text}
"""

${hairPreset ? `인물의 헤어스타일은 항상 다음과 같이 고정해주세요: ${hairPreset.desc}\n` : ''}

위 베이스 컨셉과 동일한 배경, 동일한 조명, 동일한 무드/톤을 유지하면서, 아래 컷 리스트 각각에 대해 영문 프롬프트를 작성해주세요. 각 컷마다 포즈, 카메라 구도, 프레이밍, 크롭 위치, 실루엣 비율은 컷의 목적에 맞게 다르게 구성하되, 배경/분위기/조명/헤어는 절대 바뀌지 않아야 합니다.

컷 리스트:
${cutListText}

각 컷에 대해 의류/제품 디테일이나 인물의 얼굴 생김새는 언급하지 마세요.

반드시 아래 JSON 형식으로만 응답하세요 (마크다운 코드펜스 없이 순수 JSON):
{
  "cuts": [
    { "name": "컷 이름 그대로", "prompt": "영문 프롬프트 전체 (마지막 줄에 Aspect ratio: X:X 포함)" }
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
        body: JSON.stringify({ model, max_tokens: 1200, messages: [{ role: 'user', content }] })
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
      body: JSON.stringify({ model, max_tokens: 1200, messages: [{ role: 'user', content }] })
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

    if (provider === 'claude') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({ model, max_tokens: 3000, messages: [{ role: 'user', content: promptText }] })
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
      body: JSON.stringify({ model, max_tokens: 3000, messages: [{ role: 'user', content: promptText }] })
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
