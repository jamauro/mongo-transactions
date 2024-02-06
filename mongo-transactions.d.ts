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
export declare const withTransaction: <T>(
  fn: () => Promise<T>,
  options?: {
    autoRetry?: boolean;
    [key: string]: any;
  }
) => Promise<T>;


/**
 * Checks whether the current session is in a Transaction.
 *
 * @returns {boolean} Returns `true` if the current session is in a Transaction, `false` otherwise.
 */
export declare const inTransaction: () => boolean;

declare module 'meteor/mongo' {
  type WithTransactionType = typeof withTransaction;
  type InTransactionType = typeof inTransaction;

  namespace Mongo {
    export const withTransaction: WithTransactionType;
    export const inTransaction: InTransactionType;
  }
}
