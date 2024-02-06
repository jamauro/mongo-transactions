import { Mongo } from 'meteor/mongo';

let _withTxn = false;

// here to support isomorphic code but transactions only truly run on the server
export const inTransaction = () => false;
export const withTransaction = async fn => {
  _withTxn = true;
  return await fn();
}

// for some reason, I was seeing write fails from Meteor._debug even though they were succeeding
// so this supressess the errors on the client for the function that runs inside withTransaction
const originalMeteorDebug = Meteor._debug;
Meteor._debug = function (m, s) {
  if (_withTxn && s.reason === 'Access denied') {
    setTimeout(() => _withTxn = false, 1)
    return;
  } else {
    return originalMeteorDebug.call(this, m, s)
  }
}

Mongo.inTransaction = inTransaction;
Mongo.withTransaction = withTransaction;


