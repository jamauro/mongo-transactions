import { Meteor } from 'meteor/meteor';
import { Mongo, MongoInternals } from 'meteor/mongo';

const currentSession = new Meteor.EnvironmentVariable();
const { client } = MongoInternals.defaultRemoteCollectionDriver().mongo;
const RawCollection = MongoInternals.NpmModules.mongodb.module.Collection;

const replaceMethods = ['replaceOne', 'findOneAndReplace'];
const hasOperator = obj => Object.keys(obj).some(k => k.includes('$'));
const isUpdateOrReplace = (methodName, args) => args.length === 2 && (replaceMethods.includes(methodName) || hasOperator(args[1]));

function wrapWithSession(methodName, args) {
  const session = currentSession.get();
  if (!session || session?.hasEnded) {
    return args;
  }

  let options;
  let callback; // 2.X support, eventually can remove. callbacks are not supported but this is to enable 2.X support with *Async as people are migrating to 3.X. for some reason updateAsync was still expecting a callback in 2.X, might be a Meteor bug or maybe it's by design, either way it works as expected in 3.X so not sure it's worth addressing.

  if (args.length > 1) {
    if (typeof args[args.length - 1] === 'function') { // 2.X support, eventually can remove.
      callback = args.pop();
    }

    if (!isUpdateOrReplace(methodName, args)) {
      options = args.pop();
    }
  }

  const finalOptions = { ...options, session };
  const finalArgs = args.length ? [...args, finalOptions] : [{}, finalOptions];
  if (callback) finalArgs.push(callback); // 2.X support, eventually can remove.

  return finalArgs;
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
    return originalMethod.call(this, ...wrapWithSession(methodName, args))
  }
});

/**
 * Checks whether the current session is in a Transaction.
 *
 * @function
 * @returns {boolean} Returns `true` if the current session is in a Transaction, `false` otherwise.
 */
export const inTransaction = () => {
  const session = currentSession.get();
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
 * @param {TransactionOptions} [options] - Options specific to MongoDB Transactions (writeConcern, readConcern, etc). See the Mongo Docs for more details.
 * @returns {Promise<T>} - A promise resolving to the result of the provided function.
 * @throws {Error} - Throws an error if the Transaction encounters an issue and cannot be committed.
 */
export const withTransaction = async(fn, { autoRetry = true, ...options } = {}) => {
  const txnOptions = { readPreference: 'primary', ...options };
  const session = client.startSession();

  return await currentSession.withValue(session, async function () {
    try {
      let result;
      const txnFn = async () => {
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
      currentSession._set(undefined);
    }
  });
};

Mongo.withTransaction = withTransaction;
Mongo.inTransaction = inTransaction;
