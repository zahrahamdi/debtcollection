'use strict';

const { userDisplayName } = require('../services/auth.service');

function getActorName(req) {
  return userDisplayName(req.user);
}

module.exports = { getActorName };
