const WRITE_KEY_PROPERTY = 'AVALON_WRITE_KEY';
const SETTINGS_SHEET_NAME = 'settings';
const UNKNOWN_PLAYER_ID_PREFIX = 'unknown-';
const UNKNOWN_PLAYER_NAME = '未知';

function doPost(e) {
  try {
    const body = parseJsonBody(e);
    verifyWriteKey(body.writeKey);

    switch (body.action) {
      case 'createSessionRecord':
      case 'createDailyRecord':
        return jsonResponse(createSessionRecord(body.payload));

      case 'updateSessionRecord':
      case 'updateDailyRecord':
        return jsonResponse(updateSessionRecord(body.payload));

      case 'createGameRecord':
        return jsonResponse(createGameRecord(body.payload));

      case 'updateGameRecord':
        return jsonResponse(updateGameRecord(body.payload));

      case 'deleteGameRecord':
        return jsonResponse(deleteGameRecord(body.payload));

      default:
        throw new Error(`Unknown action: ${body.action}`);
    }
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function parseJsonBody(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('Missing request body');
  }

  return JSON.parse(e.postData.contents);
}

function verifyWriteKey(writeKey) {
  const expected = PropertiesService.getScriptProperties().getProperty(WRITE_KEY_PROPERTY);

  if (!expected) {
    throw new Error(`Script property ${WRITE_KEY_PROPERTY} is not configured`);
  }

  if (!writeKey || writeKey !== expected) {
    throw new Error('Invalid writeKey');
  }
}

function createSessionRecord(payload) {
  const date = String(payload.date || '').trim();
  const title = String(payload.title || '').trim();
  const note = String(payload.note || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Invalid date, expected YYYY-MM-DD');
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  cleanupRecordSheetIndex(spreadsheet);

  const sheetName = nextAvailableSheetName(spreadsheet, date);
  const newSheet = spreadsheet.insertSheet(sheetName);
  const gid = newSheet.getSheetId();
  const updatedAt = createUpdatedAt();

  formatRecordSheetAsPlainText(newSheet);

  const dailyRange = newSheet.getRange(1, 1, 6, 2);

  writePlainTextRange(dailyRange, [
    ['sessionRecord', ''],
    ['date', date],
    ['title', title],
    ['note', note],
    ['schemaVersion', '1'],
    ['updatedAt', updatedAt],
  ]);

  const recordSheet = {
    date,
    sheetName,
    gid,
    updatedAt,
  };

  appendRecordSheetIndex(spreadsheet, recordSheet);

  return {
    ok: true,
    recordSheet,
  };
}

function updateSessionRecord(payload) {
  if (!payload) {
    throw new Error('Missing updateSessionRecord payload');
  }

  const recordSheetName = String(payload.recordSheetName || '').trim();
  const date = String(payload.date || '').trim();
  const title = String(payload.title || '').trim();
  const note = String(payload.note || '').trim();

  if (!recordSheetName) {
    throw new Error('Missing recordSheetName');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Invalid date, expected YYYY-MM-DD');
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  cleanupRecordSheetIndex(spreadsheet);

  const recordSheet = spreadsheet.getSheetByName(recordSheetName);

  if (!recordSheet) {
    throw new Error(`Record sheet not found: ${recordSheetName}`);
  }

  const updatedAt = createUpdatedAt();

  upsertRecordMetadata(recordSheet, 'date', date);
  upsertRecordMetadata(recordSheet, 'title', title);
  upsertRecordMetadata(recordSheet, 'note', note);
  upsertRecordMetadata(recordSheet, 'updatedAt', updatedAt);
  updateRecordSheetIndex(spreadsheet, recordSheetName, date);

  return {
    ok: true,
    recordSheet: {
      date,
      sheetName: recordSheetName,
      gid: recordSheet.getSheetId(),
      updatedAt,
    },
  };
}

function createGameRecord(payload) {
  if (!payload) {
    throw new Error('Missing createGameRecord payload');
  }

  const recordSheetName = String(payload.recordSheetName || '').trim();
  const game = payload.game || {};

  if (!recordSheetName) {
    throw new Error('Missing recordSheetName');
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const recordSheet = spreadsheet.getSheetByName(recordSheetName);

  if (!recordSheet) {
    throw new Error(`Record sheet not found: ${recordSheetName}`);
  }

  const gameId = nextGameId(recordSheet);
  const rows = buildGameRecordRows(buildWritableGameRecord(game, gameId, spreadsheet), {
    includeLeadingBlank: true,
  });

  appendRows(recordSheet, rows);
  bumpSessionRecordUpdatedAt(recordSheet);

  return {
    ok: true,
    gameId,
  };
}

function updateGameRecord(payload) {
  if (!payload) {
    throw new Error('Missing updateGameRecord payload');
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const recordSheet = getRecordSheet(payload.recordSheetName);
  const gameId = String(payload.gameId || '').trim();

  if (!gameId) {
    throw new Error('Missing gameId');
  }

  const block = findGameRecordBlock(recordSheet, gameId);

  if (!block) {
    throw new Error(`Game record not found: ${gameId}`);
  }

  const rows = buildGameRecordRows(
    buildWritableGameRecord(payload.game || {}, gameId, spreadsheet),
    {
      includeLeadingBlank: false,
    },
  );

  replaceRows(recordSheet, block.startRow, block.rowCount, rows);
  bumpSessionRecordUpdatedAt(recordSheet);

  return {
    ok: true,
    gameId,
  };
}

function deleteGameRecord(payload) {
  if (!payload) {
    throw new Error('Missing deleteGameRecord payload');
  }

  const recordSheet = getRecordSheet(payload.recordSheetName);
  const gameId = String(payload.gameId || '').trim();

  if (!gameId) {
    throw new Error('Missing gameId');
  }

  const block = findGameRecordBlock(recordSheet, gameId);

  if (!block) {
    throw new Error(`Game record not found: ${gameId}`);
  }

  recordSheet.deleteRows(block.startRow, block.rowCount);
  bumpSessionRecordUpdatedAt(recordSheet);

  return {
    ok: true,
    gameId,
  };
}

function getRecordSheet(recordSheetName) {
  const sheetName = String(recordSheetName || '').trim();

  if (!sheetName) {
    throw new Error('Missing recordSheetName');
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const recordSheet = spreadsheet.getSheetByName(sheetName);

  if (!recordSheet) {
    throw new Error(`Record sheet not found: ${sheetName}`);
  }

  return recordSheet;
}

function buildWritableGameRecord(game, gameId, spreadsheet) {
  const resolvedGame = resolveGamePlayerReferences(spreadsheet, game || {});
  const players = normalizeGamePlayers(resolvedGame.players);
  const playerCount = players.length;

  if (playerCount < 5 || playerCount > 10) {
    throw new Error('Game player count must be between 5 and 10');
  }

  const explicitVictoryCondition = normalizeVictoryCondition(resolvedGame.victoryCondition);
  const analyzed = analyzeGameActions(resolvedGame.actions || [], players);
  const victoryCondition = explicitVictoryCondition || analyzed.victoryCondition || 'unknown';
  const writableGameRecord = {
    id: gameId,
    updatedAt: createUpdatedAt(),
    playerCount,
    initialLeader: normalizePlayerId(resolvedGame.initialLeader || players[0].playerId || ''),
    winner: getVictorySide(victoryCondition),
    victoryCondition,
    players,
    ladyOfTheLake: analyzed.ladyOfTheLake,
    assassination: analyzed.assassination,
    rounds: analyzed.rounds,
  };

  if (resolvedGame.newPlayerRows.length > 0) {
    appendSettingsPlayers(resolvedGame.settingsBlock, resolvedGame.newPlayerRows);
  }

  return writableGameRecord;
}

function normalizeGamePlayers(players) {
  if (!Array.isArray(players)) {
    return [];
  }

  return players
    .map((player) => ({
      playerId: normalizePlayerId(player.playerId),
      role: String(player.role || '').trim(),
    }))
    .filter((player) => player.playerId);
}

function resolveGamePlayerReferences(spreadsheet, game) {
  const resolved = resolveSettingsPlayers(spreadsheet, game.players);

  return {
    ...game,
    initialLeader: remapPlayerId(game.initialLeader, resolved.idMap),
    players: resolved.players,
    actions: remapGameActions(game.actions || [], resolved.idMap),
    settingsBlock: resolved.settingsBlock,
    newPlayerRows: resolved.newPlayerRows,
  };
}

function resolveSettingsPlayers(spreadsheet, players) {
  if (!Array.isArray(players)) {
    return {
      players: [],
      idMap: new Map(),
      settingsBlock: readSettingsPlayers(spreadsheet).block,
      newPlayerRows: [],
    };
  }

  const settings = readSettingsPlayers(spreadsheet);
  const idMap = new Map();
  let nextPlayerId = getNextSettingsPlayerId(settings.players);
  const newPlayerRows = [];
  const resolvedPlayers = [];

  players.forEach((player) => {
    const originalPlayerId = normalizePlayerId(player.playerId);
    const playerName = String(player.playerName || '').trim();
    const role = String(player.role || '').trim();

    if (!originalPlayerId) {
      return;
    }

    const resolvedPlayerId = resolveSettingPlayerId(
      settings,
      originalPlayerId,
      playerName,
      nextPlayerId,
    );

    if (resolvedPlayerId.created) {
      nextPlayerId += 1;
      newPlayerRows.push([resolvedPlayerId.playerId, playerName]);
      settings.players.push({
        id: resolvedPlayerId.playerId,
        name: playerName,
      });
      settings.playersById.set(resolvedPlayerId.playerId, playerName);
      settings.playersByName.set(normalizePlayerName(playerName), resolvedPlayerId.playerId);
    }

    idMap.set(originalPlayerId, resolvedPlayerId.playerId);
    resolvedPlayers.push({
      playerId: resolvedPlayerId.playerId,
      role,
    });
  });

  return {
    players: resolvedPlayers,
    idMap,
    settingsBlock: settings.block,
    newPlayerRows,
  };
}

function resolveSettingPlayerId(settings, playerId, playerName, nextPlayerId) {
  if (settings.playersById.has(playerId)) {
    return {
      playerId,
      created: false,
    };
  }

  const existingPlayerId = settings.playersByName.get(normalizePlayerName(playerName));

  if (existingPlayerId) {
    return {
      playerId: existingPlayerId,
      created: false,
    };
  }

  if (!shouldCreateSettingPlayer(playerId, playerName)) {
    return {
      playerId,
      created: false,
    };
  }

  return {
    playerId: String(nextPlayerId),
    created: true,
  };
}

function shouldCreateSettingPlayer(playerId, playerName) {
  return Boolean(playerName) && playerName !== UNKNOWN_PLAYER_NAME && !isUnknownPlayerId(playerId);
}

function readSettingsPlayers(spreadsheet) {
  const settingsSheet = getSettingsSheet(spreadsheet);
  const values = settingsSheet.getDataRange().getValues();
  const block = findPlayersBlock(settingsSheet, values);
  const players = [];
  const playersById = new Map();
  const playersByName = new Map();

  for (let row = block.headerRow + 1; row < block.endRow; row += 1) {
    const playerId = normalizePlayerId(values[row]?.[block.idColumn]);
    const playerName = String(values[row]?.[block.nameColumn] || '').trim();

    if (!playerId && !playerName) {
      continue;
    }

    players.push({
      id: playerId,
      name: playerName,
    });

    if (playerId) {
      playersById.set(playerId, playerName);
    }

    if (playerName) {
      playersByName.set(normalizePlayerName(playerName), playerId);
    }
  }

  return {
    block,
    players,
    playersById,
    playersByName,
  };
}

function findPlayersBlock(settingsSheet, values) {
  const marker = findCell(values, 'players');

  if (!marker) {
    throw new Error('settings sheet players block not found');
  }

  const headerRowIndex = marker.row + 1;
  const headerRow = values[headerRowIndex] || [];
  const idColumn = findHeaderColumn(headerRow, marker.column, 'id');
  const nameColumn = findHeaderColumn(headerRow, marker.column, 'name');

  if (idColumn < 0 || nameColumn < 0) {
    throw new Error('players block must include id and name headers');
  }

  let endRow = headerRowIndex + 1;

  while (endRow < values.length) {
    const row = values[endRow] || [];

    if (isBlankRow(row) || isSettingsSectionMarker(row[marker.column])) {
      break;
    }

    endRow += 1;
  }

  return {
    sheet: settingsSheet,
    headerRow: headerRowIndex,
    endRow,
    markerColumn: marker.column,
    startColumn: Math.min(idColumn, nameColumn),
    idColumn,
    nameColumn,
    width: Math.abs(nameColumn - idColumn) + 1,
  };
}

function appendSettingsPlayers(block, playerRows) {
  const startRow = block.endRow + 1;
  const normalizedRows = playerRows.map(([playerId, playerName]) => {
    const row = Array.from({ length: block.width }, () => '');

    row[block.idColumn - block.startColumn] = playerId;
    row[block.nameColumn - block.startColumn] = playerName;

    return row;
  });

  block.sheet.insertRowsBefore(startRow, normalizedRows.length);
  const range = block.sheet.getRange(
    startRow,
    block.startColumn + 1,
    normalizedRows.length,
    block.width,
  );

  writePlainTextRange(range, normalizedRows);
}

function getNextSettingsPlayerId(players) {
  const maxId = players.reduce((max, player) => {
    const id = normalizePlayerId(player.id);

    return /^\d+$/.test(id) ? Math.max(max, Number(id)) : max;
  }, 0);

  return maxId + 1;
}

function remapGameActions(actions, idMap) {
  if (!Array.isArray(actions)) {
    return [];
  }

  return actions.map((action) => ({
    ...action,
    team: remapPlayerIdList(action.team, idMap),
    approveVotes: remapPlayerIdList(action.approveVotes, idMap),
    rejectVotes: remapPlayerIdList(action.rejectVotes, idMap),
    ladyOfTheLake: action.ladyOfTheLake
      ? {
        ...action.ladyOfTheLake,
        holder: remapPlayerId(action.ladyOfTheLake.holder, idMap),
        target: remapPlayerId(action.ladyOfTheLake.target, idMap),
      }
      : null,
    assassination: action.assassination
      ? {
        ...action.assassination,
        assassin: remapPlayerId(action.assassination.assassin, idMap),
        target: remapPlayerId(action.assassination.target, idMap),
      }
      : null,
  }));
}

function remapPlayerIdList(value, idMap) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((playerId) => remapPlayerId(playerId, idMap)).filter(Boolean);
}

function remapPlayerId(value, idMap) {
  const playerId = normalizePlayerId(value);

  return idMap.get(playerId) || playerId;
}

function analyzeGameActions(actions, players) {
  if (!Array.isArray(actions)) {
    throw new Error('Game actions must be an array');
  }

  const playerCount = players.length;
  const playerById = new Map(players.map((player) => [player.playerId, player]));
  const rounds = [];
  const ladyOfTheLake = [];
  let assassination = null;

  let questNumber = 1;
  let rejectedAttempts = 0;
  let successfulQuests = 0;
  let failedQuests = 0;
  let winner = '';
  let victoryCondition = '';

  for (const action of actions) {
    if (winner) {
      throw new Error('Game actions contain records after the game ended');
    }

    const team = normalizeIdList(action.team);
    const approveVotes = normalizeIdList(action.approveVotes);
    const rejectVotes = normalizeIdList(action.rejectVotes);
    const approved = approveVotes.length > playerCount / 2;
    const questCards = normalizeQuestCards(action.questCards);
    const failCount = questCards.filter((card) => card === 'fail').length;

    validatePlayerIds(team, playerById, 'team');
    validatePlayerIds(approveVotes, playerById, 'approveVotes');
    validatePlayerIds(rejectVotes, playerById, 'rejectVotes');

    if (approved) {
      if (questCards.length !== team.length) {
        throw new Error(
          `Quest ${questNumber} is approved but questCards count does not match team size`,
        );
      }

      const requiredFails = requiredFailCards(playerCount, questNumber);
      const result = failCount >= requiredFails ? 'fail' : 'success';

      rounds.push({
        round: questNumber,
        team,
        approved: true,
        approveVotes,
        rejectVotes,
        result,
        failCount,
      });

      if (action.ladyOfTheLake && action.ladyOfTheLake.holder && action.ladyOfTheLake.target) {
        ladyOfTheLake.push({
          roundAfter: questNumber,
          holder: normalizePlayerId(action.ladyOfTheLake.holder),
          target: normalizePlayerId(action.ladyOfTheLake.target),
          claimedAlignment: String(action.ladyOfTheLake.claimedAlignment || '').trim(),
        });
      }

      if (action.assassination && action.assassination.target) {
        assassination = {
          assassin: normalizePlayerId(action.assassination.assassin),
          target: normalizePlayerId(action.assassination.target),
        };
      }

      rejectedAttempts = 0;

      if (result === 'success') {
        successfulQuests += 1;
      } else {
        failedQuests += 1;
      }

      if (failedQuests >= 3) {
        winner = 'evil';
        victoryCondition = 'evilThreeFails';
      }

      if (successfulQuests >= 3) {
        if (!assassination || !assassination.target) {
          winner = 'unknown';
          victoryCondition = 'unknown';
          questNumber += 1;
          continue;
        }

        const targetRole = playerById.get(assassination.target)?.role || '';

        if (targetRole === 'merlin') {
          winner = 'evil';
          victoryCondition = 'evilAssassinKilledMerlin';
        } else {
          winner = 'good';
          victoryCondition = 'goodThreeQuests';
        }
      }

      questNumber += 1;
    } else {
      rounds.push({
        round: questNumber,
        team,
        approved: false,
        approveVotes,
        rejectVotes,
        result: '',
        failCount: '',
      });

      rejectedAttempts += 1;

      if (rejectedAttempts >= 5) {
        winner = 'evil';
        victoryCondition = 'evilFiveRejectedTeams';
      }
    }
  }

  return {
    winner: winner || 'unknown',
    victoryCondition: victoryCondition || 'unknown',
    ladyOfTheLake,
    assassination,
    rounds,
  };
}

function normalizeVictoryCondition(value) {
  const condition = String(value || '').trim();
  const allowed = new Set([
    'goodThreeQuests',
    'evilThreeFails',
    'evilFiveRejectedTeams',
    'evilAssassinKilledMerlin',
    'unknown',
  ]);

  return allowed.has(condition) ? condition : '';
}

function getVictorySide(victoryCondition) {
  if (victoryCondition === 'unknown') {
    return 'unknown';
  }

  return victoryCondition === 'goodThreeQuests' ? 'good' : 'evil';
}

function buildGameRecordRows(game, options) {
  const rows = [
    ...(options && options.includeLeadingBlank ? [[]] : []),
    ['gameRecord'],
    ['id', game.id],
    ['updatedAt', game.updatedAt],
    ['playerCount', game.playerCount],
    ['initialLeader', game.initialLeader],
    ['winner', game.winner],
    ['victoryCondition', game.victoryCondition],
    ['note', ''],
    [],
    ['players'],
    ['id', 'role'],
  ];

  game.players.forEach((player) => {
    rows.push([player.playerId, player.role]);
  });

  rows.push([], ['ladyOfTheLake'], ['roundAfter', 'holder', 'target', 'claimedAlignment']);

  game.ladyOfTheLake.forEach((record) => {
    rows.push([record.roundAfter, record.holder, record.target, record.claimedAlignment]);
  });

  rows.push([], ['assassination'], ['assassin', 'target']);

  if (game.assassination) {
    rows.push([game.assassination.assassin, game.assassination.target]);
  }

  rows.push(
    [],
    ['rounds'],
    ['round', 'team', 'approved', 'approveVotes', 'rejectVotes', 'result', 'failCount'],
  );

  game.rounds.forEach((round) => {
    rows.push([
      round.round,
      round.team.join(','),
      round.approved ? 'TRUE' : 'FALSE',
      round.approveVotes.join(','),
      round.rejectVotes.join(','),
      round.result,
      round.failCount,
    ]);
  });

  return rows;
}

function appendRows(sheet, rows) {
  writeRows(sheet, sheet.getLastRow() + 1, rows);
}

function replaceRows(sheet, startRow, oldRowCount, rows) {
  sheet.insertRowsBefore(startRow, rows.length);
  writeRows(sheet, startRow, rows);
  sheet.deleteRows(startRow + rows.length, oldRowCount);
}

function writeRows(sheet, startRow, rows) {
  const width = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => {
    const normalized = row.slice();

    while (normalized.length < width) {
      normalized.push('');
    }

    return normalized;
  });

  const range = sheet.getRange(startRow, 1, normalizedRows.length, width);

  writePlainTextRange(range, normalizedRows);
}

function writePlainTextRange(range, rows) {
  range.setNumberFormat('@');
  range.setValues(toPlainTextRows(rows));
}

function writePlainTextCell(range, value) {
  range.setNumberFormat('@');
  range.setValue(toPlainTextCellValue(value));
}

function toPlainTextRows(rows) {
  return rows.map((row) => row.map(toPlainTextCellValue));
}

function toPlainTextCellValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

function formatRecordSheetAsPlainText(sheet) {
  const columnCount = Math.min(sheet.getMaxColumns(), 10);

  sheet.getRange(1, 1, sheet.getMaxRows(), columnCount).setNumberFormat('@');
}

function findGameRecordBlock(sheet, gameId) {
  const values = sheet.getDataRange().getValues();

  for (let row = 0; row < values.length; row += 1) {
    if (normalizeKey(values[row][0]) !== 'gamerecord') {
      continue;
    }

    const endRow = findNextGameRecordRow(values, row + 1);
    const currentGameId = findGameIdInBlock(values, row + 1, endRow);

    if (currentGameId === gameId) {
      return {
        startRow: row + 1,
        rowCount: endRow - row,
      };
    }
  }

  return null;
}

function findNextGameRecordRow(values, startRow) {
  for (let row = startRow; row < values.length; row += 1) {
    if (normalizeKey(values[row][0]) === 'gamerecord') {
      return row;
    }
  }

  return values.length;
}

function findGameIdInBlock(values, startRow, endRow) {
  for (let row = startRow; row < endRow; row += 1) {
    const key = normalizeKey(values[row][0]);

    if (key === 'id') {
      return String(values[row][1] || '').trim();
    }

    if (
      key === 'players' ||
      key === 'ladyofthelake' ||
      key === 'assassination' ||
      key === 'rounds'
    ) {
      return '';
    }
  }

  return '';
}

function nextGameId(sheet) {
  const values = sheet.getDataRange().getValues();
  let maxId = 0;

  for (let row = 0; row < values.length; row += 1) {
    if (normalizeKey(values[row][0]) !== 'gamerecord') {
      continue;
    }

    for (let cursor = row + 1; cursor < values.length; cursor += 1) {
      const key = normalizeKey(values[cursor][0]);

      if (!key) {
        continue;
      }

      if (
        key === 'gamerecord' ||
        key === 'players' ||
        key === 'ladyofthelake' ||
        key === 'assassination' ||
        key === 'rounds'
      ) {
        break;
      }

      if (key === 'id') {
        const id = String(values[cursor][1] || '').trim();
        const match = id.match(/^game-(\d+)$/);

        if (match) {
          maxId = Math.max(maxId, Number(match[1]));
        }

        break;
      }
    }
  }

  return `game-${String(maxId + 1).padStart(3, '0')}`;
}

function requiredFailCards(playerCount, questNumber) {
  if (playerCount >= 7 && questNumber === 4) {
    return 2;
  }

  return 1;
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizePlayerId).filter(Boolean);
}

function normalizePlayerId(value) {
  const trimmed = String(value || '').trim();

  if (!/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  return String(Number(trimmed));
}

function isUnknownPlayerId(playerId) {
  return String(playerId || '')
    .trim()
    .toLowerCase()
    .startsWith(UNKNOWN_PLAYER_ID_PREFIX);
}

function normalizePlayerName(playerName) {
  return String(playerName || '')
    .trim()
    .toLowerCase();
}

function normalizeQuestCards(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || '').trim())
    .filter((item) => item === 'success' || item === 'fail');
}

function validatePlayerIds(ids, playerById, fieldName) {
  ids.forEach((id) => {
    if (!playerById.has(id)) {
      throw new Error(`${fieldName} contains non-game player: ${id}`);
    }
  });
}

function nextAvailableSheetName(spreadsheet, date) {
  if (!spreadsheet.getSheetByName(date)) {
    return date;
  }

  let index = 2;
  while (spreadsheet.getSheetByName(`${date}-${index}`)) {
    index += 1;
  }

  return `${date}-${index}`;
}

function appendRecordSheetIndex(spreadsheet, recordSheet) {
  const settingsSheet = getSettingsSheet(spreadsheet);
  const target = findRecordSheetsAppendTarget(settingsSheet);

  const range = settingsSheet.getRange(target.row, target.startColumn, 1, 3);

  writePlainTextRange(range, [[recordSheet.date, recordSheet.sheetName, recordSheet.gid]]);
}

function cleanupRecordSheetIndex(spreadsheet) {
  const settingsSheet = getSettingsSheet(spreadsheet);
  const block = findRecordSheetsBlock(settingsSheet);

  if (!block || block.rowCount <= 0) {
    return;
  }

  const range = settingsSheet.getRange(
    block.startRow,
    block.startColumn,
    block.rowCount,
    block.width,
  );
  const rows = range.getDisplayValues();
  const existingRows = rows.filter((row) => {
    const sheetName = String(row[block.sheetNameOffset] || '').trim();

    return sheetName && Boolean(spreadsheet.getSheetByName(sheetName));
  });
  const emptyRows = Array.from({ length: block.rowCount - existingRows.length }, () =>
    Array.from({ length: block.width }, () => ''),
  );

  writePlainTextRange(range, [...existingRows, ...emptyRows]);
}

function updateRecordSheetIndex(spreadsheet, recordSheetName, date) {
  const settingsSheet = getSettingsSheet(spreadsheet);
  const target = findRecordSheetsAppendTarget(settingsSheet);
  const values = settingsSheet.getDataRange().getValues();
  const marker = findCell(values, 'recordsheets');

  if (!marker) {
    throw new Error('recordSheets block not found');
  }

  const headerRowIndex = marker.row + 1;
  const headerRow = values[headerRowIndex] || [];
  const dateColumn = findHeaderColumn(headerRow, marker.column, 'date');
  const sheetNameColumn = findHeaderColumn(headerRow, marker.column, 'sheetname');

  for (let row = headerRowIndex + 1; row < target.row - 1; row += 1) {
    if (String(values[row]?.[sheetNameColumn] || '').trim() === recordSheetName) {
      const range = settingsSheet.getRange(row + 1, dateColumn + 1);

      writePlainTextCell(range, date);
      return;
    }
  }

  throw new Error(`recordSheets index not found: ${recordSheetName}`);
}

function findRecordSheetsBlock(settingsSheet) {
  const values = settingsSheet.getDataRange().getValues();
  const marker = findCell(values, 'recordsheets');

  if (!marker) {
    return null;
  }

  const headerRowIndex = marker.row + 1;
  const headerRow = values[headerRowIndex] || [];
  const dateColumn = findHeaderColumn(headerRow, marker.column, 'date');
  const sheetNameColumn = findHeaderColumn(headerRow, marker.column, 'sheetname');
  const gidColumn = findHeaderColumn(headerRow, marker.column, 'gid');

  if (dateColumn < 0 || sheetNameColumn < 0 || gidColumn < 0) {
    throw new Error('recordSheets must include date, sheetName, gid headers');
  }

  const startColumn = Math.min(dateColumn, sheetNameColumn, gidColumn);
  const endColumn = Math.max(dateColumn, sheetNameColumn, gidColumn);
  let endRowIndex = headerRowIndex + 1;

  while (endRowIndex < values.length) {
    const row = values[endRowIndex] || [];
    const hasRecord = [dateColumn, sheetNameColumn, gidColumn].some((column) =>
      String(row[column] || '').trim(),
    );

    if (!hasRecord) {
      break;
    }

    endRowIndex += 1;
  }

  return {
    startRow: headerRowIndex + 2,
    startColumn: startColumn + 1,
    rowCount: endRowIndex - headerRowIndex - 1,
    width: endColumn - startColumn + 1,
    sheetNameOffset: sheetNameColumn - startColumn,
  };
}

function upsertRecordMetadata(recordSheet, key, value) {
  const values = recordSheet.getDataRange().getValues();
  const normalizedKey = normalizeKey(key);

  for (let row = 0; row < values.length; row += 1) {
    if (normalizeKey(values[row][0]) === normalizedKey) {
      const range = recordSheet.getRange(row + 1, 2);

      writePlainTextCell(range, value);
      return;
    }

    if (normalizeKey(values[row][0]) === 'gamerecord') {
      recordSheet.insertRowsBefore(row + 1, 1);
      const range = recordSheet.getRange(row + 1, 1, 1, 2);

      writePlainTextRange(range, [[key, value]]);
      return;
    }
  }

  const targetRow = Math.max(recordSheet.getLastRow(), 1) + 1;
  const range = recordSheet.getRange(targetRow, 1, 1, 2);

  writePlainTextRange(range, [[key, value]]);
}

function bumpSessionRecordUpdatedAt(recordSheet) {
  upsertRecordMetadata(recordSheet, 'updatedAt', createUpdatedAt());
}

function createUpdatedAt() {
  return new Date().toISOString();
}

function getSettingsSheet(spreadsheet) {
  const settingsSheet = spreadsheet.getSheetByName(SETTINGS_SHEET_NAME);

  if (!settingsSheet) {
    throw new Error(`Settings sheet not found: ${SETTINGS_SHEET_NAME}`);
  }

  return settingsSheet;
}

function findRecordSheetsAppendTarget(settingsSheet) {
  const values = settingsSheet.getDataRange().getValues();
  const marker = findCell(values, 'recordsheets');

  if (!marker) {
    return createRecordSheetsBlock(settingsSheet, values);
  }

  const headerRowIndex = marker.row + 1;
  const headerRow = values[headerRowIndex] || [];
  const dateColumn = findHeaderColumn(headerRow, marker.column, 'date');
  const sheetNameColumn = findHeaderColumn(headerRow, marker.column, 'sheetname');
  const gidColumn = findHeaderColumn(headerRow, marker.column, 'gid');

  if (dateColumn < 0 || sheetNameColumn < 0 || gidColumn < 0) {
    throw new Error('recordSheets must include date, sheetName, gid headers');
  }

  const startColumn = Math.min(dateColumn, sheetNameColumn, gidColumn);
  const endColumn = Math.max(dateColumn, sheetNameColumn, gidColumn);

  let nextRowIndex = headerRowIndex + 1;

  while (nextRowIndex < values.length) {
    const row = values[nextRowIndex] || [];
    const hasRecord = [dateColumn, sheetNameColumn, gidColumn].some((column) =>
      String(row[column] || '').trim(),
    );

    if (!hasRecord) {
      break;
    }

    nextRowIndex += 1;
  }

  return {
    row: nextRowIndex + 1,
    startColumn: startColumn + 1,
    endColumn: endColumn + 1,
  };
}

function createRecordSheetsBlock(settingsSheet, values) {
  const lastUsedRow = findLastUsedRow(values);
  const markerRow = lastUsedRow + 2;

  const range = settingsSheet.getRange(markerRow, 1, 2, 3);

  writePlainTextRange(range, [
    ['recordSheets', '', ''],
    ['date', 'sheetName', 'gid'],
  ]);

  return {
    row: markerRow + 2,
    startColumn: 1,
    endColumn: 3,
  };
}

function findLastUsedRow(values) {
  for (let row = values.length - 1; row >= 0; row -= 1) {
    if ((values[row] || []).some((cell) => String(cell || '').trim())) {
      return row + 1;
    }
  }

  return 0;
}

function isBlankRow(row) {
  return (row || []).every((cell) => !String(cell || '').trim());
}

function isSettingsSectionMarker(value) {
  const key = normalizeKey(value);

  return key === 'players' || key === 'appconfig' || key === 'recordsheets';
}

function findCell(values, normalizedNeedle) {
  for (let row = 0; row < values.length; row += 1) {
    for (let column = 0; column < values[row].length; column += 1) {
      if (normalizeKey(values[row][column]) === normalizedNeedle) {
        return { row, column };
      }
    }
  }

  return null;
}

function findHeaderColumn(headerRow, startColumn, normalizedHeader) {
  for (let column = startColumn; column < headerRow.length; column += 1) {
    if (normalizeKey(headerRow[column]) === normalizedHeader) {
      return column;
    }
  }

  return -1;
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
