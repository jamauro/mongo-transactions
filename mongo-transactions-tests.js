import { Tinytest } from 'meteor/tinytest';
import { Mongo } from 'meteor/mongo';
import { DDP } from 'meteor/ddp-client';

const Invoices = new Mongo.Collection('invoices');
const InvoiceItems = new Mongo.Collection('invoice_items');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function reset() {
  await Invoices.removeAsync({});
  await InvoiceItems.removeAsync({});
}

async function insertInvoices({ fail = false } = {}) {
  try {
    return await Mongo.withTransaction(async() => {
      const invoiceId = await Invoices.insertAsync({
        total: 100,
      });

      const itemId = await InvoiceItems.insertAsync({
        total: 50,
        invoiceId,
      });

      if (fail) {
        throw new Error('fail on purpose')
      }

      return 'success';
    });
  } catch(error) {
    console.log(error.message)
  }
}

async function updateInvoice({ invoiceId, timeoutBefore, timeoutAfter, id, autoRetry = true }) {
  try {
    return await Mongo.withTransaction(async () => {
      console.log(`Transaction ${id} waiting before update ${timeoutBefore} ms`);

      const invoice = await Invoices.findOneAsync(invoiceId);
      console.log(`Transaction ${id} read total of ${invoice.total}`);

      await wait(timeoutBefore);
      console.log(`Transaction ${id} updating`);

      await Invoices.updateAsync(invoiceId, {
        $set: {
          total: invoice.total + 50
        }
      });

      console.log(`Transaction ${id} waiting after update ${timeoutAfter} ms`);
      await wait(timeoutAfter);
      console.log(`Transaction ${id} done`);
    }, { autoRetry });
  } catch(error) {
    throw new Meteor.Error('update failed', error.message)
  }
}

async function fetchInvoicesAndItems() {
  const invoices = await Invoices.find().fetchAsync();
  const items = await InvoiceItems.find().fetchAsync();

  return { invoices, items };
}

async function insertInvoiceNoTransaction(data) {
  return Invoices.insertAsync(data);
}

if (Meteor.isServer) {
  Meteor.methods({ reset, insertInvoices, updateInvoice, fetchInvoicesAndItems, insertInvoiceNoTransaction })
}

Tinytest.addAsync('isomorphic - success', async (test) => {
  const result = await Mongo.withTransaction(async() => {
    const invoiceId = await Invoices.insertAsync({
      total: 100,
    });

    console.log('invoiceId', invoiceId)

    const itemId = await InvoiceItems.insertAsync({
      total: 50,
      invoiceId,
    });

    await Invoices.updateAsync({_id: invoiceId}, {$set: {quantity: 2}});

    return 'success';
  });

  if (Meteor.isClient) {
    test.equal(result, 'success')
  }

  if (Meteor.isServer) {
    test.equal(result, 'success');

    const invoices = await Invoices.find().fetchAsync();
    test.equal(invoices.length, 1);
    test.equal(invoices[0].quantity, 2)

    const items = await InvoiceItems.find().fetchAsync();
    test.equal(items.length, 1);
  }

  await Meteor.callAsync('reset')
});

Tinytest.addAsync('isomorphic - rollsback on error', async (test) => {
  let invoiceId;
  let result;

  try {
    result = await Mongo.withTransaction(async() => {
      invoiceId = await Invoices.insertAsync({
        total: 100,
      });

      const itemId = await InvoiceItems.insertAsync({
        total: 50,
        invoiceId,
      });

      await Invoices.updateAsync({_id: invoiceId}, {$set: {quantity: 2}});

      if (Meteor.isServer) {
        await wait(1000);
        throw new Error('fail')
      }

      return invoiceId;
    });
  } catch(error) {
    if (Meteor.isClient) {
      test.equal(error.message, undefined)
    }

    if (Meteor.isServer) {
      test.equal(error.message, 'fail')
    }
  }


  if (Meteor.isClient) {
    test.equal(typeof result, 'string')
    test.equal(result, invoiceId)

    const invoices = await Invoices.find().fetchAsync();
    test.equal(invoices.length, 1);

    const items = await InvoiceItems.find().fetchAsync();
    test.equal(items.length, 1);
  }

  if (Meteor.isServer) {
    test.equal(result, undefined);

    const invoices = await Invoices.find().fetchAsync();
    test.equal(invoices.length, 0);

    const items = await InvoiceItems.find().fetchAsync();
    test.equal(items.length, 0);
  }

  await Meteor.callAsync('reset')
});

if (Meteor.isServer) {
  Tinytest.addAsync('simple insert', async (test) => {
    await reset();

    const result = await Mongo.withTransaction(async() => {
      return Invoices.insertAsync({total: 100})
    });

    const invoices = await Invoices.find().fetchAsync();
    test.equal(invoices.length, 1)
    test.equal(invoices[0].total, 100)
  });

  Tinytest.addAsync('simple remove', async (test) => {
    const result = await Mongo.withTransaction(async() => {
      return Invoices.removeAsync({})
    });

    const invoices = await Invoices.find().fetchAsync();
    test.equal(invoices.length, 0)
  });

  Tinytest.addAsync('insert - transaction successfully inserts', async (test) => {
    await reset();
    let invId;
    let itmId;

    const result = await Mongo.withTransaction(async() => {
      const invoiceId = await Invoices.insertAsync({
        total: 100,
      });

      invId = invoiceId

      const itemId = await InvoiceItems.insertAsync({
        total: 50,
        invoiceId,
      });

      itmId = itemId

      return { invoiceId, itemId };
    });

    test.equal(result, { invoiceId: invId, itemId: itmId })

    const invoices = await Invoices.find().fetchAsync();
    test.equal(invoices.length, 1)
    test.equal(invoices[0], {
      _id: invId,
      total: 100
    })

    const items = await InvoiceItems.find().fetchAsync();
    test.equal(items.length, 1)
    test.equal(items[0], {
      _id: itmId,
      invoiceId: invId,
      total: 50
    })
  });

  Tinytest.addAsync('insert - no insert when transaction fails', async (test) => {
    await reset();

    try {
      const result = await Mongo.withTransaction(async() => {
        const invoiceId = await Invoices.insertAsync({
          total: 100,
        });

        const itemId = await InvoiceItems.insertAsync({
          total: 50,
          invoiceId,
        });

        throw new Error('fail')

        return { invoiceId, itemId };
      });

      test.equal('should not be reached', true);
    } catch(error) {
      test.equal(error.message, 'fail')
    }

    const invoices = await Invoices.find().fetchAsync();
    test.equal(invoices.length, 0);

    const items = await InvoiceItems.find().fetchAsync();
    test.equal(items.length, 0);
  });

  Tinytest.addAsync('update - transaction successfully updates', async (test) => {
    await reset();

    const invoiceId = await Invoices.insertAsync({
      total: 100
    });

    const itemId = await InvoiceItems.insertAsync({
      total: 50,
      invoiceId
    });


    const result = await Mongo.withTransaction(async() => {
      await Invoices.find({}, {sort: {total: -1}}).fetchAsync(); // test .find with options

      await Invoices.updateAsync(invoiceId, {
        $set: {
          total: 150
        }
      });

      await InvoiceItems.updateAsync(itemId, {
        $set: {
          total: 100,
          quantity: 2
        }
      });

      return 'success';
    });

    test.equal(result, 'success');

    const invoices = await Invoices.find().fetchAsync();
    test.equal(invoices.length, 1)
    test.equal(invoices[0], {
      _id: invoiceId,
      total: 150
    })

    const items = await InvoiceItems.find().fetchAsync();
    test.equal(items.length, 1)
    test.equal(items[0], {
      _id: itemId,
      invoiceId: invoiceId,
      quantity: 2,
      total: 100
    })
  });

  Tinytest.addAsync('update - rollsback when transaction fails', async (test) => {
    await reset();

    const invoiceId = await Invoices.insertAsync({
      total: 100
    });

    const itemId = await InvoiceItems.insertAsync({
      total: 50,
      invoiceId
    });

    try {
      const result = await Mongo.withTransaction(async() => {
        await Invoices.updateAsync(invoiceId, {
          $set: {
            total: 150
          },
        });

        await InvoiceItems.updateAsync(itemId, {
          $set: {
            total: 100,
            quantity: 2
          },
        });

        throw new Error('fail')

        return 'success';
      });

      test.equal('should never be reached', true);
    } catch(error) {
      test.equal(error.message, 'fail');
    }

    const invoices = await Invoices.find().fetchAsync();
    test.equal(invoices.length, 1)
    test.equal(invoices[0], {
      _id: invoiceId,
      total: 100
    })

    const items = await InvoiceItems.find().fetchAsync();
    test.equal(items.length, 1)
    test.equal(items[0], {
      _id: itemId,
      invoiceId: invoiceId,
      total: 50
    });
    test.equal(items[0].quantity, undefined)
  });

  Tinytest.addAsync('update - multi, transaction successfully updates', async (test) => {
    await reset();

    const invoiceId = await Invoices.insertAsync({
      total: 100
    });

    await Invoices.insertAsync({
      total: 100
    });

    const itemId = await InvoiceItems.insertAsync({
      total: 50,
      invoiceId
    });


    const result = await Mongo.withTransaction(async() => {
      await Invoices.updateAsync({total: 100}, { $set: { total: 150 }}, { multi: true });

      await InvoiceItems.updateAsync(itemId, {
        $set: {
          total: 100,
          quantity: 2
        },
      });

      return 'success';
    });

    test.equal(result, 'success');

    const invoices = await Invoices.find().fetchAsync();
    test.equal(invoices.length, 2)
    test.equal(invoices.map(i => i.total), [150, 150])

    const items = await InvoiceItems.find().fetchAsync();
    test.equal(items.length, 1)
    test.equal(items[0], {
      _id: itemId,
      invoiceId: invoiceId,
      quantity: 2,
      total: 100
    })
  });

  Tinytest.addAsync('remove - transaction successfully removes', async (test) => {
    await reset();

    const invoiceId = await Invoices.insertAsync({
      total: 100
    });

    const itemId = await InvoiceItems.insertAsync({
      total: 50,
      invoiceId
    });

    const result = await Mongo.withTransaction(async() => {
      await Invoices.removeAsync(invoiceId);

      await InvoiceItems.removeAsync(itemId);

      return 'success';
    });

    test.equal(result, 'success');

    const invoices = await Invoices.find().fetchAsync();
    test.equal(invoices.length, 0)

    const items = await InvoiceItems.find().fetchAsync();
    test.equal(items.length, 0)
  });

  Tinytest.addAsync('remove - rollsback when transaction fails', async (test) => {
    await reset();

    const invoiceId = await Invoices.insertAsync({
      total: 100
    });

    const itemId = await InvoiceItems.insertAsync({
      total: 50,
      invoiceId
    });

    try {
      const result = await Mongo.withTransaction(async() => {
        await Invoices.removeAsync(invoiceId);

        await InvoiceItems.removeAsync(itemId);

        throw new Error('fail')

        return 'success';
      });

      test.equal('should never be reached', true);
    } catch(error) {
      test.equal(error.message, 'fail');
    }


    const invoices = await Invoices.find().fetchAsync();
    test.equal(invoices.length, 1)

    const items = await InvoiceItems.find().fetchAsync();
    test.equal(items.length, 1)
  });

  Tinytest.addAsync('rawCollection() - transaction successful', async (test) => {
    await reset();

    const result = await Mongo.withTransaction(async() => {
      const invoiceId = await Invoices.insertAsync({ raw: false, total: 100 });

      await Invoices.rawCollection().insertOne({ raw: true, total: 10 });

      return 'success';
    });

    test.equal(result, 'success');

    const invoices = await Invoices.find().fetchAsync();
    test.equal(invoices.length, 2)
    test.equal(invoices.filter(i => !i.raw)[0].total, 100)
    test.equal(invoices.filter(i => i.raw)[0].total, 10)
  });

  Tinytest.addAsync('rawCollection() - rollsback both on transaction fail', async (test) => {
    await reset();

    try {
      const result = await Mongo.withTransaction(async() => {
        const invoiceId = await Invoices.insertAsync({ raw: false, total: 100 });

        await Invoices.rawCollection().insertOne({ raw: true, total: 10 });

        throw new Error('fail');

        return 'success';
      });

      test.equal('should never be reached', true);
    } catch(error) {
      test.equal(error.message, 'fail')
    }


    const invoices = await Invoices.find().fetchAsync();
    test.equal(invoices.length, 0)
  });

  Tinytest.addAsync('inTransaction', async (test) => {
    test.equal(Mongo.inTransaction(), false)
    await Mongo.withTransaction(async() => {
      test.equal(Mongo.inTransaction(), true)
    })
    test.equal(Mongo.inTransaction(), false)
  });

  Tinytest.addAsync('Core API - works successfully', async (test) => {
    await reset();
    let invId;
    let itmId;

    const result = await Mongo.withTransaction(async() => {
      const invoiceId = await Invoices.insertAsync({
        total: 100,
      });

      invId = invoiceId

      const itemId = await InvoiceItems.insertAsync({
        total: 50,
        invoiceId,
      });

      itmId = itemId

      return { invoiceId, itemId };
    }, { autoRetry: false });

    test.equal(result, { invoiceId: invId, itemId: itmId })

    const invoices = await Invoices.find().fetchAsync();
    test.equal(invoices.length, 1)
    test.equal(invoices[0], {
      _id: invId,
      total: 100
    })

    const items = await InvoiceItems.find().fetchAsync();
    test.equal(items.length, 1)
    test.equal(items[0], {
      _id: itmId,
      invoiceId: invId,
      total: 50
    })
  });

  Tinytest.addAsync('Core API - transaction fails as expected', async (test) => {
    await reset();

    try {
      const result = await Mongo.withTransaction(async() => {
        const invoiceId = await Invoices.insertAsync({
          total: 100,
        });

        const itemId = await InvoiceItems.insertAsync({
          total: 50,
          invoiceId,
        });

        throw new Error('fail')

        return { invoiceId, itemId };
      }, { autoRetry: false });

      test.equal('should not be reached', true);
    } catch(error) {
      test.equal(error.message, 'fail')
    }

    const invoices = await Invoices.find().fetchAsync();
    test.equal(invoices.length, 0);

    const items = await InvoiceItems.find().fetchAsync();
    test.equal(items.length, 0);
  });
}

function createConnection() {
  return DDP.connect(Meteor.connection._stream.rawUrl, Meteor.connection.options);
}

function callPromise(methodName, ...args) { // using this instead of Meteor.callAsync because .callAsync was still in development
  return new Promise((resolve, reject) => {
    Meteor.call(methodName, ...args, (err, res) => {
      if (err) {
        reject(err);
      }
      else {
        resolve(res);
      }
    });
  });
}

function callWithConnectionPromise(connection, methodName, ...args) {
  return new Promise((resolve, reject) => {
    connection.call(methodName, ...args, (err, res) => { // using this instead of .callAsync because I couldn't get .callAsync to work with connection
      if (err) {
        reject(err);
      }
      else {
        resolve(res);
      }
    });
  });
}

Tinytest.addAsync('multiple inserts from different clients - all succeed', async (test) => {
  if (Meteor.isClient) {
    const USER_COUNT = 20;

    const connectionPool = Array.from({ length: USER_COUNT }, () => createConnection());
    const promises = connectionPool.map(connection => callWithConnectionPromise(connection, 'insertInvoices'));

    await Promise.all(promises);
    connectionPool.forEach(connection => connection.close());

    const { invoices, items } = await callPromise('fetchInvoicesAndItems');
    test.equal(invoices.length, 20);
    test.equal(items.length, 20);

    await callPromise('reset');
  }
});

const isEven = num => num % 2 === 0;

Tinytest.addAsync('multiple inserts from different clients - handles when some fail', async (test) => {
  if (Meteor.isClient) {
    const USER_COUNT = 20;

    const connectionPool = Array.from({ length: USER_COUNT }, () => createConnection());
    const promises = connectionPool.map((connection, i) => callWithConnectionPromise(connection, 'insertInvoices', isEven(i) && { fail: true }));

    await Promise.all(promises);
    connectionPool.forEach(connection => connection.close());

    const { invoices, items } = await callPromise('fetchInvoicesAndItems');
    test.equal(invoices.length, 10);
    test.equal(items.length, 10);

    await callPromise('reset');
  }
});

async function runConcurrentTransactions(invoiceId, { autoRetry = true } = {}) {
  const conn1 = createConnection();
  const conn2 = createConnection();

  /**
   * Creating scenario where first transaction updates the document, but does not finish.
   * Second transaction then tries to update the same doc (1st is still inside the transaction).
   *
   * Steps:
   * 1. Transaction 1 starts
   * 2. Transaction 1 updates
   * 3. Transaction 2 starts
   * 4. Transaction 2 updates (this fails if using Core API transactions)
   * 5. Transaction 2 ends
   * 6. Transaction 1 ends
   *
   */

  try {
    const [ res1, res2 ] = await Promise.all([
      callWithConnectionPromise(conn1, 'updateInvoice', {
        invoiceId,
        timeoutBefore: 200,
        timeoutAfter: 2000,
        id: 1,
        autoRetry
      }),
      callWithConnectionPromise(conn2, 'updateInvoice', {
        invoiceId,
        timeoutBefore: 2000,
        timeoutAfter: 100,
        id: 2,
        autoRetry
      })
    ]);

    return [res1, res2];
  } finally {
    // Close connections or perform cleanup here
    conn1.close();
    conn2.close();
  }
}

Tinytest.addAsync('concurrency - works by default', async (test) => {
  if (Meteor.isClient) {
    const invoiceId = await callPromise('insertInvoiceNoTransaction', {total: 50});
    const [ res1, res2 ] = await runConcurrentTransactions(invoiceId);

    test.equal(res1, undefined);
    test.equal(res2, undefined);

    const { invoices } = await callPromise('fetchInvoicesAndItems', {});
    test.equal(invoices.length, 1);

    const [ invoice ] = invoices;
    test.equal(invoice.total, 150);

    await callPromise('reset');
  }
});

Tinytest.addAsync('concurrency - fails and gives WriteError when using Core API ({ autoRetry: false })', async (test) => {
  if (Meteor.isClient) {
    try {
      const invoiceId = await callPromise('insertInvoiceNoTransaction', {total: 50});
      const [ res1, res2 ] = await runConcurrentTransactions(invoiceId, { autoRetry: false });

      test.equal(res1, undefined);
      test.equal(res2, undefined);

      const { invoices } = await callPromise('fetchInvoicesAndItems', {});
    } catch(error) {
      test.isTrue(error.message.includes('WriteConflict error'));
    } finally {
      await callPromise('reset');
    }
  }
});



