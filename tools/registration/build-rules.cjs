const fs = require('node:fs');
const path = require('node:path');

/** Keep protocol 3/1 rules unchanged; derive only the explicitly separate contracts. */
function registrationRules(legacy) {
  const added = {
    characterRegistry: {
      '.write': false,
      active: { '.read': 'auth != null' },
      revisions: { '$revision': { '.read': "auth != null && $revision.matches(/^[a-f0-9]{64}$/)" } },
    },
  };
  for (const [oldName, name, oldVersion, version] of [
    ['rooms', 'registeredRooms', 3, 4], ['coopRooms', 'registeredCoopRooms', 1, 2],
  ]) {
    const oldIndex = oldName === 'rooms' ? 'open' : 'coopOpen';
    const newIndex = oldName === 'rooms' ? 'registeredOpen' : 'registeredCoopOpen';
    const translate = text => text.replaceAll("'" + oldName + "'", "'" + name + "'")
      .replaceAll("'" + oldIndex + "'", "'" + newIndex + "'")
      .replaceAll("child('protocol').val() === " + oldVersion, "child('protocol').val() === " + version)
      .replaceAll("child('v').val() === " + oldVersion, "child('v').val() === " + version);
    const clone = node => Object.fromEntries(Object.entries(node).map(([key, value]) =>
      [key, typeof value === 'string' ? translate(value) : value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : value]));
    added[newIndex] = clone(legacy[oldIndex]);
    const room = clone(legacy[oldName].$room);
    const roomRef = `root.child('${name}').child($room)`;
    const registry = `root.child('characterRegistry').child('revisions').child(${roomRef}.child('registryRevision').val())`;
    const active = `root.child('characterRegistry').child('active').child('registryRevision').val()`;
    room.protocol['.validate'] = `newData.val() === ${version}`;
    room['.validate'] = `(${room['.validate']}) && newData.hasChildren(['registryRevision']) && (!data.exists() || data.child('expiresAt').val() <= now || newData.child('registryRevision').val() === data.child('registryRevision').val())`;
    room['.write'] = `(${room['.write']}) && (!newData.exists() || (newData.child('registryRevision').val() === ${active} && root.child('characterRegistry').child('revisions').child(newData.child('registryRevision').val()).child('runtimeContract').val() === 'katamon-gameplay-1'))`;
    room.registryRevision = { '.read': `auth != null && data.parent().child('expiresAt').val() > now`, '.validate': `newData.isString() && newData.val().matches(/^[a-f0-9]{64}$/) && (!data.exists() || newData.val() === data.val())` };
    const messages = room.rounds.$roundId.messages.$message;
    messages.v['.validate'] = `newData.val() === ${version}`;
    messages.registryRevision = { '.validate': `newData.val() === ${roomRef}.child('registryRevision').val()` };
    messages['.validate'] = `(${messages['.validate']}) && newData.hasChildren(['registryRevision'])`;
    // A packet body is opaque JSON in coop. This envelope does not pretend Rules parse it.
    if (oldName === 'rooms') {
      messages.character['.validate'] = `newData.isString() && ${registry}.child('characters').child(newData.val()).child('gameId').val() === newData.val()`;
      messages.definitionHash = { '.validate': `newData.isString() && newData.val() === ${registry}.child('characters').child(newData.parent().child('character').val()).child('definitionHash').val()` };
      messages['.validate'] += ` && (newData.child('t').val() !== 'reveal' || newData.hasChildren(['character','definitionHash'])) && (newData.child('t').val() === 'reveal' || (!newData.child('character').exists() && !newData.child('definitionHash').exists()))`;
      // This write-time gate is atomic with the status transition at Firebase.
      room.round['.write'] = `(${room.round['.write']}) && newData.exists() && (newData.child('id').val() === data.child('id').val() || newData.child('status').val() === 'lobby') && (newData.child('status').val() !== 'revealing' || data.child('status').val() === 'revealing' || ${roomRef}.child('registryRevision').val() === ${active}) && (newData.child('status').val() !== 'playing' || (newData.child('id').val() === data.child('id').val() && (data.child('status').val() === 'revealing' || data.child('status').val() === 'playing'))) `;
    } else {
      const slots = room.slots.$seat;
      slots['.write'] = `(${slots['.write']}) && (!data.exists() || !newData.exists() || ${roomRef}.child('phase').val() === 'lobby' || (newData.child('character').val() === data.child('character').val() && newData.child('definitionHash').val() === data.child('definitionHash').val()))`;
      room.round['.write'] = `(${room.round['.write']}) && newData.exists() && (${roomRef}.child('phase').val() === 'lobby' || newData.child('id').val() === data.child('id').val())`;
      const charCheck = location => `${registry}.child('characters').child(${location}).child('gameId').val() === ${location}`;
      slots.character['.validate'] = `newData.isString() && ${charCheck('newData.val()')}`;
      slots.definitionHash = { '.validate': `newData.val() === ${registry}.child('characters').child(newData.parent().child('character').val()).child('definitionHash').val()` };
      // During initial room creation use newData's ancestry, rather than a root room that does not yet exist.
      const createdRegistry = "root.child('characterRegistry').child('revisions').child(newData.parent().parent().child('registryRevision').val())";
      slots['.validate'] = `(${slots['.validate']}) && newData.hasChildren(['definitionHash']) && ${createdRegistry}.child('characters').child(newData.child('character').val()).child('definitionHash').val() === newData.child('definitionHash').val()`;
      slots.character['.validate'] = `newData.isString() && root.child('characterRegistry').child('revisions').child(newData.parent().parent().parent().child('registryRevision').val()).child('characters').child(newData.val()).exists()`;
      slots.definitionHash['.validate'] = 'newData.isString() && newData.val().matches(/^[a-f0-9]{64}$/)';
      for (const seat of ['e1','s1','s2']) room.settings.aiCharacters[seat]['.validate'] = `newData.isString() && root.child('characterRegistry').child('revisions').child(newData.parent().parent().parent().child('registryRevision').val()).child('characters').child(newData.val()).exists()`;
      room.phase['.write'] = `(${room.phase['.write']}) && ((newData.val() !== 'launching' && newData.val() !== 'playing') || data.val() === newData.val() || ${roomRef}.child('registryRevision').val() === ${active})`;
    }
    added[name] = { $room: room };
  }
  return added;
}

if (require.main === module) {
  const file = path.resolve(__dirname, '../../database.rules.json');
  const source = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(source);
  const added = registrationRules(parsed.rules);
  if (process.argv.includes('--check')) {
    for (const [key, value] of Object.entries(added)) if (JSON.stringify(parsed.rules[key]) !== JSON.stringify(value)) throw new Error('Registration Rules are stale: ' + key);
  } else {
    const marker = ',\n    "characterRegistry":';
    const first = source.indexOf(marker);
    const original = first >= 0 ? source.slice(0, first) : source.slice(0, source.lastIndexOf('\n  }')).trimEnd();
    const sections = Object.entries(added).map(([key,value]) => '    ' + JSON.stringify(key) + ': ' + JSON.stringify(value, null, 2).replaceAll('\n', '\n    ')).join(',\n');
    fs.writeFileSync(file, original + ',\n' + sections + '\n  }\n}\n');
  }
}
module.exports = { registrationRules };
