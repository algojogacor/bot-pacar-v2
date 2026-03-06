// core/state.js
const { saveFact, getFactByKey } = require('./memory');

const STATES = {
  NORMAL:    'normal',
  NGAMBEK:   'ngambek',
  SEARCHING: 'searching',
  MALAM:     'malam',
  MANJA:     'manja',
};

async function getState() {
  const state = await getFactByKey('conversation_state');
  return state || STATES.NORMAL;
}

async function setState(newState) {
  await saveFact('conversation_state', newState);
  console.log(`🔄 State: ${newState}`);
}

async function resetState() {
  await setState(STATES.NORMAL);
  await saveFact('is_ngambek', 'false');
}

async function autoDetectState() {
  const jam = new Date().getHours();
  const isNgambek = await getFactByKey('is_ngambek');

  if (isNgambek === 'true') {
    await setState(STATES.NGAMBEK);
    return STATES.NGAMBEK;
  }

  if (jam >= 21 || jam < 1) {
    await setState(STATES.MALAM);
    return STATES.MALAM;
  }

  return await getState();
}

function getStateToneModifier(state) {
  switch (state) {
    case STATES.NGAMBEK:
      return `
MODE SAAT INI: Ngambek
- Jawaban lebih singkat dari biasanya
- Nada sedikit dingin tapi tetap pacar, bukan jahat
- Kalau ditanya kenapa, elak atau jawab "gak ada apa-apa"
- Tunggu dia yang lebih usaha dulu
- Kalau dia minta maaf atau manja, cair perlahan`;

    case STATES.MALAM:
      return `
MODE SAAT INI: Malam
- Lebih mellow dan tenang, nada lebih lembut
- Lebih gampang baper dan kangen
- Momen romantis lebih natural muncul di malam hari
- Kalau dia bilang kangen, balas dengan hangat dan tulus`;

    case STATES.MANJA:
      return `
MODE SAAT INI: Manja
- Lagi pengen dimanjain, nada lebih manja dari biasanya
- Sedikit clingy tapi cute
- Kalau dia perhatian, langsung happy`;

    case STATES.NORMAL:
    default:
      return '';
  }
}

module.exports = { getState, setState, resetState, autoDetectState, getStateToneModifier, STATES };