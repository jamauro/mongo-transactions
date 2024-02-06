import { Meteor } from 'meteor/meteor';
import { Mongo, MongoInternals } from 'meteor/mongo';

const sessionVariable = new Meteor.EnvironmentVariable();
const { client } = MongoInternals.defaultRemoteCollectionDriver().mongo;
const RawCollection = MongoInternals.NpmModules.mongodb.module.Collection;

function wrapWithSession(...args) {
  const { session } = sessionVariable.get() || {};
  if (!session) {
    return args;
  }

  let options;
  let callback;

  if (args.length > 1) {
    const lastArg = args[args.length - 1];
    if (typeof lastArg === 'function') {
      callback = args.pop();
    }

    options = args.pop();
  }

  return [...args, { ...(options ?? {}), session }, ...(callback ? [callback] : [])]; // callbacks are not supported but this is to enable 2.X support with *Async as people are migrating to 3.X. for some reason updateAsync was still expecting a callback in 2.X, might be a Meteor bug or maybe it's by design, either way it works as expected in 3.X so not sure it's worth addressing.
}

function getMethodNames(obj) {
  let methodNames = [];
  const descriptors = Object.getOwnPropertyDescriptors(obj.prototype);

  for (const prop in descriptors) {
    const value = descriptors[prop].value
    if (prop !== 'constructor' && typeof value === 'function') {
      methodNames.push(prop);
    }
  }

  return methodNames;
}

// patch rawCollection methods to add session for Transactions
getMethodNames(RawCollection).forEach(methodName => {
  const originalMethod = RawCollection.prototype[methodName];

  RawCollection.prototype[methodName] = function(...args) {
    return originalMethod.call(this, ...wrapWithSession(...args))
  }
});

/**
 * Checks whether the current session is in a Transaction.
 *
 * @function
 * @returns {boolean} Returns `true` if the current session is in a Transaction, `false` otherwise.
 */
export const inTransaction = () => {
  const { session } = sessionVariable.get() || {};
  return session?.inTransaction() ?? false;
};

/**
 * Executes a function within a MongoDB Transaction, providing error handling and optional retry functionality.
 *
 * @async
 * @function
 * @template T
 * @param {() => Promise<T>} fn - The function to be executed within the Transaction.
 * @param {boolean} [options.autoRetry=true] - If true, uses the Mongo Transactions Callback API for automatic retry on certain errors (refer to Mongo Docs); otherwise, uses the Core API.
 * @param {...any} [options] - Options specific to MongoDB Transactions (writeConcern, readConcern, etc). See the Mongo Docs for more details.
 * @returns {Promise<T>} - A promise resolving to the result of the provided function.
 * @throws {Error} - Throws an error if the Transaction encounters an issue and cannot be committed.
 */
export const withTransaction = async(fn, { autoRetry = true, ...txnOptions } = {}) => {
  const session = client.startSession();

  return await sessionVariable.withValue({ session }, async function () {
    try {
      let result;
      const txnFn = async () => { // allows us to return the result of the function that we passed in to withTransaction
        result = await fn();
      };

      if (autoRetry) {
        await session.withTransaction(txnFn, txnOptions);
      } else {
        try {
          session.startTransaction(txnOptions);
          await txnFn();
          await session.commitTransaction();
        } catch(error) {
          await session.abortTransaction();
          throw error;
        }
      }

      return result;
    } finally {
      await session.endSession();
    }
  });
};

Mongo.withTransaction = withTransaction;
Mongo.inTransaction = inTransaction;

