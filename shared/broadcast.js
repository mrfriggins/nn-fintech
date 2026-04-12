const EventEmitter = require('events');

class Broadcast extends EventEmitter {}

const broadcast = new Broadcast();

module.exports = broadcast;