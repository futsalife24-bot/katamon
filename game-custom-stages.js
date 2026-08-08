(function () {
  'use strict';

  var core = globalThis.StageCore;
  var storageModule = globalThis.StageStorage;
  var repositoryModule = globalThis.StageRepository;
  var zipModule = globalThis.StageZip;
  if (!core || !storageModule || !repositoryModule) return;
  var bootBridge = globalThis.KatamonCustomStageBridge || null;
  if (bootBridge && bootBridge.getState && bootBridge.getState().featureEnabled === false) return;

  var selectedStageId = null;
  var managerMode = 'local';
  // MVPの保存先は必ず端末内provider。将来の投稿先はこの境界の実装を追加して切り替える。
  var repository = repositoryModule.createLocalProvider({ storageModule: storageModule });
  var launcher = document.createElement('button');
  launcher.id = 'customStageLauncher';
  launcher.type = 'button';
  launcher.hidden = true;
  launcher.textContent = 'カスタムステージ';
  launcher.setAttribute('data-testid', 'custom-stage-button');

  var overlay = document.createElement('section');
  overlay.id = 'customStageOverlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML =
    '<div class="custom-stage-dialog" role="dialog" aria-modal="true" aria-labelledby="customStageTitle">' +
      '<header class="custom-stage-header">' +
        '<div><h2 id="customStageTitle">カスタムステージ</h2><div class="custom-stage-note">公式ステージとは別に、この端末だけへ保存されます。</div></div>' +
        '<button class="custom-stage-close" type="button" data-action="close" aria-label="閉じる">閉じる</button>' +
      '</header>' +
      '<div class="custom-stage-toolbar">' +
        '<button class="custom-stage-primary" type="button" data-action="import">ステージをインポート</button>' +
        '<a class="custom-stage-action" href="tools/stage-studio/">Stage Studioを開く</a>' +
      '</div>' +
      '<input type="file" hidden accept=".json,.zip,application/json,application/zip" data-testid="custom-stage-import">' +
      '<div id="customStageStatus" role="status" aria-live="polite"></div>' +
      '<div id="customStageList" class="custom-stage-list" data-testid="custom-stage-list"></div>' +
      '<footer class="custom-stage-footer">' +
        '<small id="customStageSelection">ステージを選んでください</small>' +
        '<button class="custom-stage-primary" type="button" data-action="start" data-testid="custom-battle-start" disabled>このステージでバトル開始</button>' +
      '</footer>' +
    '</div>';
  document.body.appendChild(launcher);
  document.body.appendChild(overlay);

  var fileInput = overlay.querySelector('input[type="file"]');
  var listElement = overlay.querySelector('#customStageList');
  var statusElement = overlay.querySelector('#customStageStatus');
  var selectionElement = overlay.querySelector('#customStageSelection');
  var startButton = overlay.querySelector('[data-action="start"]');

  function bridge() {
    return globalThis.KatamonCustomStageBridge || null;
  }

  function setStatus(message, kind) {
    statusElement.textContent = message || '';
    statusElement.dataset.kind = kind || '';
  }

  function compatibilityText(compatibility) {
    if (!compatibility || typeof compatibility !== 'object') return '未確認';
    return String(compatibility.gameId || '対象不明') + ' / '
      + String(compatibility.minBuild || '下限不明') + '〜'
      + String(compatibility.maxBuild || '上限なし');
  }

  function identityRows(stage) {
    return [
      { label: 'stageId', value: stage && stage.stageId || '未確認' },
      { label: 'schemaVersion', value: stage && stage.schemaVersion || '未確認' },
      { label: 'contentHash', value: stage && stage.checksums && stage.checksums.contentHash || '未計算' },
      { label: 'gameCompatibility', value: compatibilityText(stage && stage.gameCompatibility) }
    ];
  }

  function renderSelection(stage) {
    if (!stage) {
      selectionElement.textContent = 'ステージを選んでください';
      return;
    }
    var lines = ['選択中: ' + stage.title];
    identityRows(stage).forEach(function (row) {
      lines.push(row.label + ': ' + String(row.value));
    });
    lines.push('バトル開始直前に4項目を再照合します。');
    selectionElement.textContent = lines.join('\n');
  }

  function stageFromRecord(record) {
    if (!record) return null;
    return record.stage || record.data || record.value || record;
  }

  async function getStages() {
    var records = await repository.listCustom();
    var stages = [];
    for (var index = 0; index < records.length; index += 1) {
      var stage = stageFromRecord(records[index]);
      if (stage && stage.terrain) {
        stages.push(stage);
      } else {
        var id = records[index] && (records[index].stageId || records[index].id || records[index].key);
        if (id) {
          var full = stageFromRecord(await repository.getCustom(id));
          if (full) stages.push(full);
        }
      }
    }
    return stages.sort(function (a, b) {
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
  }

  function drawPreview(canvas, stage) {
    var context = canvas.getContext('2d');
    var width = canvas.width = 288;
    var height = canvas.height = 192;
    var gradient = context.createLinearGradient(0, 0, 0, height);
    var from = stage.background && stage.background.gradient ? stage.background.gradient.from : '#6DA9D2';
    var to = stage.background && stage.background.gradient ? stage.background.gradient.to : '#D7E8E8';
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.fillStyle = stage.materials && stage.materials[0] ? stage.materials[0].color : '#7A5435';
    var columns = stage.terrain && stage.terrain.columns || [];
    var scaleX = width / core.LIMITS.stageWidth;
    var scaleY = height / core.LIMITS.stageHeight;
    columns.forEach(function (segments, columnIndex) {
      segments.forEach(function (segment) {
        context.fillRect(columnIndex * core.LIMITS.columnWidth * scaleX, segment[0] * scaleY, Math.max(1, core.LIMITS.columnWidth * scaleX + 1), (segment[1] - segment[0]) * scaleY);
      });
    });
    (stage.spawnPoints || []).forEach(function (spawn) {
      context.beginPath();
      context.fillStyle = spawn.team === 'enemy' ? '#ff6b6b' : '#4fc3f7';
      context.arc(spawn.x * scaleX, spawn.y * scaleY, 5, 0, Math.PI * 2);
      context.fill();
    });
  }

  function downloadBlob(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  async function exportStage(stage, format) {
    var finalized = await core.finalizeStage(stage, { touchUpdatedAt: false });
    if (format === 'zip') {
      if (!zipModule || typeof zipModule.createStageBundle !== 'function') throw new Error('この環境ではZIP出力を利用できません。JSONで出力してください。');
      var zipBlob = await zipModule.createStageBundle(finalized);
      downloadBlob(zipBlob, core.safeFileName(finalized.title, '.stage.zip'));
    } else {
      var json = JSON.stringify(finalized, null, 2);
      downloadBlob(new Blob([json], { type: 'application/json' }), core.safeFileName(finalized.title, '.stage.json'));
    }
  }

  async function render() {
    var stages = await getStages();
    listElement.replaceChildren();
    if (!stages.length) {
      var empty = document.createElement('div');
      empty.className = 'custom-stage-empty';
      empty.textContent = '保存済みステージはありません。Stage Studioで作成するか、JSON・ZIPファイルを読み込んでください。';
      listElement.appendChild(empty);
      selectedStageId = null;
      startButton.disabled = true;
      renderSelection(null);
      return;
    }
    var selectedStage = stages.find(function (stage) { return stage.stageId === selectedStageId; });
    if (!selectedStage) selectedStageId = null;
    startButton.disabled = !selectedStage;
    renderSelection(selectedStage);
    stages.forEach(function (stage) {
      var validation = core.validateStage(stage);
      var card = document.createElement('article');
      card.className = 'custom-stage-card' + (selectedStageId === stage.stageId ? ' selected' : '');
      card.dataset.stageId = stage.stageId;
      card.setAttribute('data-testid', 'custom-stage-card');
      var preview = document.createElement('canvas');
      preview.className = 'custom-stage-preview';
      preview.setAttribute('aria-label', stage.title + 'のプレビュー');
      drawPreview(preview, stage);
      var details = document.createElement('div');
      details.className = 'custom-stage-details';
      var title = document.createElement('h3');
      title.textContent = stage.title;
      details.appendChild(title);
      [
        '作成者: ' + (stage.authorDisplayName || '作成者'),
        '作成日: ' + String(stage.createdAt || '').slice(0, 10),
        '人数: ' + (stage.battleRules && stage.battleRules.format || '1v1') + ' / ギミック: ' + (stage.gimmicks || []).length,
        '警告: ' + validation.warnings.length + '件 / 容量: ' + Math.ceil(validation.metrics.fileBytes / 1024) + 'KB'
      ].forEach(function (text) {
        var line = document.createElement('p');
        line.className = 'custom-stage-meta';
        line.textContent = text;
        details.appendChild(line);
      });
      identityRows(stage).forEach(function (row) {
        var identityLine = document.createElement('p');
        identityLine.className = 'custom-stage-meta custom-stage-identity';
        identityLine.textContent = row.label + ': ' + String(row.value);
        details.appendChild(identityLine);
      });
      var actions = document.createElement('div');
      actions.className = 'custom-stage-card-actions';
      [
        ['select', '選択', 'custom-stage-primary', 'custom-stage-select'],
        ['rename', '名前変更', 'custom-stage-action', ''],
        ['json', 'JSON出力', 'custom-stage-action', ''],
        ['zip', 'ZIP出力', 'custom-stage-action', ''],
        ['delete', '削除', 'custom-stage-danger', '']
      ].forEach(function (spec) {
        var button = document.createElement('button');
        button.type = 'button';
        button.dataset.cardAction = spec[0];
        button.dataset.stageId = stage.stageId;
        button.className = spec[2];
        button.textContent = spec[1];
        if (spec[3]) button.setAttribute('data-testid', spec[3]);
        actions.appendChild(button);
      });
      card.appendChild(preview);
      card.appendChild(details);
      card.appendChild(actions);
      listElement.appendChild(card);
    });
  }

  async function parseFile(file) {
    if (!file || file.size <= 0) throw new Error('ファイルが空です。');
    if (file.size > core.LIMITS.maxFileBytes * 3) throw new Error('ファイル容量が上限を超えています。');
    var head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    var isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
    if (isZip) {
      if (!zipModule || typeof zipModule.readStageBundle !== 'function') throw new Error('ZIP読込機能を利用できません。JSONファイルを選んでください。');
      var bundle = await zipModule.readStageBundle(file);
      return bundle.stage;
    }
    var text = await file.text();
    if (new Blob([text]).size > core.LIMITS.maxFileBytes) throw new Error('JSONの容量が上限を超えています。');
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error('JSONファイルが壊れているか、形式が違います。');
    }
  }

  async function importFile(file) {
    setStatus('安全性と互換性を確認しています…');
    var raw = await parseFile(file);
    var gameBridge = bridge();
    if (gameBridge && typeof gameBridge.validateStage === 'function') gameBridge.validateStage(raw);
    var securityValidation = core.validateStage(raw);
    if (!securityValidation.valid) throw new Error(securityValidation.errors[0].message);
    var migrated = core.migrateStage(raw);
    var hash = await core.verifyStageHash(migrated);
    if (!hash.valid) throw new Error('contentHashが一致しません。改変または破損したファイルです。');
    await repository.putCustom(migrated);
    selectedStageId = migrated.stageId;
    setStatus('「' + migrated.title + '」をインポートしました。', 'success');
    await render();
  }

  async function stageById(id) {
    return stageFromRecord(await repository.getCustom(id));
  }

  async function handleCardAction(action, id) {
    var stage = await stageById(id);
    if (!stage) throw new Error('保存済みステージを読み込めません。');
    if (action === 'select') {
      var gameBridge = bridge();
      if (!gameBridge) throw new Error('ゲームとの接続を確認できません。');
      await gameBridge.selectStage(stage);
      selectedStageId = id;
      await render();
      setStatus('ステージを選択しました。バトル開始直前に4項目を再照合します。', 'success');
      return;
    }
    if (action === 'rename') {
      var nextTitle = globalThis.prompt('新しいステージ名', stage.title);
      if (nextTitle == null) return;
      stage.title = String(nextTitle).trim();
      stage = await core.finalizeStage(stage);
      await repository.putCustom(stage);
      setStatus('名前を変更しました。', 'success');
      await render();
      return;
    }
    if (action === 'json' || action === 'zip') {
      await exportStage(stage, action);
      setStatus((action === 'zip' ? 'ZIP' : 'JSON') + 'を出力しました。', 'success');
      return;
    }
    if (action === 'delete') {
      if (!globalThis.confirm('「' + stage.title + '」をこの端末から削除しますか？公式ステージには影響しません。')) return;
      await repository.deleteCustom(id);
      if (selectedStageId === id) selectedStageId = null;
      var currentBridge = bridge();
      if (currentBridge) currentBridge.clearStage(id);
      setStatus('カスタムステージを削除しました。', 'success');
      await render();
    }
  }

  async function openManager(options) {
    managerMode = options && options.mode === 'online' ? 'online' : 'local';
    startButton.textContent = managerMode === 'online'
      ? 'このステージをオンラインで使う'
      : 'このステージでバトル開始';
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.documentElement.style.overflow = 'hidden';
    setStatus('');
    try {
      var gameBridge = bridge();
      var current = gameBridge && gameBridge.getSelectedStage ? gameBridge.getSelectedStage() : null;
      if (current) selectedStageId = current.stageId;
      await render();
    } catch (error) {
      setStatus(error && error.message || 'ステージ一覧を読み込めません。', 'error');
    }
    overlay.querySelector('[data-action="close"]').focus();
  }

  function closeManager() {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
    if (managerMode === 'online') {
      var onlineButton = document.getElementById('onlineCustomStage');
      if (onlineButton) onlineButton.focus();
    } else {
      launcher.focus();
    }
  }

  launcher.addEventListener('click', openManager);
  overlay.addEventListener('click', function (event) {
    var actionButton = event.target.closest('[data-action]');
    if (actionButton) {
      var action = actionButton.dataset.action;
      if (action === 'close') closeManager();
      if (action === 'import') fileInput.click();
      if (action === 'start' && selectedStageId) {
        stageById(selectedStageId).then(async function (stage) {
          var gameBridge = bridge();
          if (!gameBridge) throw new Error('ゲームとの接続を確認できません。');
          setStatus('stageId・schemaVersion・contentHash・gameCompatibilityを再照合しています…');
          if (managerMode === 'online') await gameBridge.selectStage(stage);
          else await gameBridge.startSelectedStage(stage);
          closeManager();
        }).catch(function (error) { setStatus(error.message, 'error'); });
      }
      return;
    }
    var cardButton = event.target.closest('[data-card-action]');
    if (cardButton) {
      handleCardAction(cardButton.dataset.cardAction, cardButton.dataset.stageId).catch(function (error) {
        setStatus(error && error.message || '操作を完了できません。', 'error');
      });
    }
  });
  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    importFile(file).catch(function (error) {
      setStatus(error && error.message || 'インポートできません。', 'error');
    });
  });
  overlay.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeManager();
  });

  setInterval(function () {
    var gameBridge = bridge();
    var state = gameBridge && gameBridge.getState ? gameBridge.getState() : null;
    // カスタムステージは演習設定の地形欄から使う。起動前やタイトルへ固定ボタンを
    // 重ねると、本編の開始演出より先に見え続けるためfreeSetupだけで表示する。
    launcher.hidden = overlay.classList.contains('open') || !state || state.onlineActive
      || state.gamePhase !== 'freeSetup';
  }, 250);

  globalThis.CustomStageManager = Object.freeze({
    open: openManager,
    close: closeManager,
    refresh: render,
    importFile: importFile
  });
})();
