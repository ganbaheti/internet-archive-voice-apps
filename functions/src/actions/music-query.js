const selectors = require('../configurator/selectors');
const playlist = require('../state/playlist');
const query = require('../state/query');
const availableSchemes = require('../strings').intents.musicQuery;
const {debug, warning} = require('../utils/logger')('ia:actions:music-query');

const acknowledge = require('./high-order-handlers/middlewares/acknowledge');
const ask = require('./high-order-handlers/middlewares/ask');
const fulfilResolvers = require('./high-order-handlers/middlewares/fulfil-resolvers');
const renderSpeech = require('./high-order-handlers/middlewares/render-speech');
const suggestions = require('./high-order-handlers/middlewares/suggestions');
const playbackFulfillment = require('./high-order-handlers/middlewares/playback-fulfillment');
const prompt = require('./high-order-handlers/middlewares/prompt');

/**
 * Handle music query action
 * - fill slots of music query
 * - call fulfilment feeder
 *
 * TODO:
 * 1) it seems we could use express.js/koa middleware architecture here
 * 2) all that could should be builder for any slot-based actions
 * and should be placed to ./helpers.
 *
 * @param app
 * @returns {Promise}
 */
function handler (app) {
  debug('Start music query handler');

  let slotScheme = selectors.find(availableSchemes, query.getSlots(app));
  checkSlotScheme(slotScheme);
  let newValues = fillSlots(app, slotScheme);
  applyDefaultSlots(app, slotScheme.defaults);

  // new values could change actual slot scheme
  const newScheme = selectors.find(availableSchemes, query.getSlots(app));
  if (slotScheme !== newScheme) {
    slotScheme = newScheme;
    // update slots for new scheme
    checkSlotScheme(slotScheme);
    newValues = Object.assign({}, newValues, fillSlots(app, slotScheme));
    applyDefaultSlots(app, slotScheme.defaults);
  }

  processPreset(app, slotScheme);

  const complete = query.hasSlots(app, slotScheme.slots);
  if (complete) {
    debug('pipeline playback');
    // Proposal:
    //
    // return feederFromSlotScheme({app, slotScheme, playlist, query})
    //   .then(playlistFromFeeder())
    //   .then((args) => {
    //     // we got playlist
    //     debug('We got playlist')
    //     return parepareSongData(args)
    //       .then(playSong());
    //   }, (args) => {
    //     debug(`we don't have playlist (or it is empty)`)
    //     debug(`TODO: propose user something else`);
    //     dialog.ask(app,
    //       `We haven't find anything by your request would you like something else?`
    //     );
    //   });
    return Promise
      .resolve({app, slotScheme, playlist, query})
      .then(playbackFulfillment());
  }

  debug('pipeline query');

  const slots = query.getSlots(app);
  debug('we had slots:', Object.keys(slots));
  return acknowledge()({app, slots, slotScheme, speech: [], newValues})
    .then(prompt())
    .then(suggestions())
    .then(fulfilResolvers())
    .then(renderSpeech())
    .then(ask());
}

// Proposal:
//
// // create playlist
//
// // fulfilment (maybe it should't be middleware for the moment
// const feederFromSlotScheme = () => ({slotScheme}) => {
//   const feederName = slotScheme.fulfilment;
//   const feeder = feeders.getByName(feederName);
//   return Object.assign({}, args, {feeder, feederName});
// };
//
// const playlistFromFeeder = () => () => {
//   playlist.setFeeder(app, slotScheme.fulfillment);
//   return feeder
//     .build({app, query, playlist})
//     .then(() => {
//       if (feeder.isEmpty({app, query, playlist})) {
//         return Promise.reject();
//       }
//       return Object.assign({}, args, {feeder, feederName});
//     })
// };
//
// const parepareSongData = () => () => {
//   dialog.processOptions(
//     feeder.getCurrentItem({app, query, playlist}),
//     {
//       muteSpeech: playback.isMuteSpeechBeforePlayback(app),
//     }
//   )
//   // comes from playlist:
//   // - imageURL
//   // - audioURL
//   // - suggestions
//   //
//   // TODO: generate from:
//   // require('../strings').dialog.playSong
//   // - description
//   // - speech
// }
//
// // middleware for mute speech before song
//
// const playSong = () => (args) => {
//   const {app} = args;
//   // dialog.playSong should return Promise
//   return dialog.playSong(app, args);
// };
//
// // playnext
//
// const feederFromPlaylist = () => ({app, playlist}) => {
//   const feederName = playlist.getFeeder(app);
//   const feeder = feeders.getByName(feederName);
//   return Object.assign({}, args, {feeder, feederName});
// };
//
// const nextSong = () => (args) => {
//   const {feeder} = args;
//   if (!feeder.hasNext({app, query, playlist})) {
//     // Don't have next song
//     return Promise.reject();
//   }
//
//   return feeder.next({app, query, playlist})
// }

/**
 *
 * @param slotScheme
 */
function checkSlotScheme (slotScheme) {
  if (!slotScheme) {
    throw new Error('There are no valid slot scheme. Need at least default');
  }

  if (slotScheme && slotScheme.name) {
    debug(`we are going with "${slotScheme.name}" slot scheme`);
  }
}

/**
 * Apply default slots from slotsScheme
 *
 * @param app
 * @param defaults
 */
function applyDefaultSlots (app, defaults) {
  if (!defaults) {
    return;
  }

  const appliedDefaults = Object.keys(defaults)
    .filter(defaultSlotName => !query.hasSlot(app, defaultSlotName))
    .map(defaultSlotName => {
      const value = defaults[defaultSlotName];
      if (value.skip) {
        query.skipSlot(app, defaultSlotName);
      } else {
        query.setSlot(
          app,
          defaultSlotName,
          defaults[defaultSlotName]
        );
      }

      return defaultSlotName;
    });

  debug('We have used defaults:', appliedDefaults);
}

/**
 *
 */
function processPreset (app, slotScheme) {
  const name = app.getArgument('preset');
  if (!name) {
    debug(`it wasn't preset`);
    return;
  }

  debug(`we got preset "${name}" in "${slotScheme.name}"`);

  if (!slotScheme.presets || !(name in slotScheme.presets)) {
    warning(`but we don't have it in presets of ${slotScheme.name}`);
    return;
  }

  const preset = slotScheme.presets[name];
  if (!('defaults' in preset)) {
    warning(`but it doesn't have defaults`);
    return;
  }

  applyDefaultSlots(app, preset.defaults);
}

/**
 * Put all received values to slots
 * and return list of new values
 *
 * @param app
 * @returns {{}}
 */
function fillSlots (app, slotScheme) {
  return slotScheme.slots
    .reduce((newValues, slotName) => {
      const value = app.getArgument(slotName);
      if (value) {
        query.setSlot(app, slotName, value);
        newValues[slotName] = value;
      }
      return newValues;
    }, {});
}

module.exports = {
  handler,
};
