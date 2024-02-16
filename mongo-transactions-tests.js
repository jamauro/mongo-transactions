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

async function updateInvoice({ invoiceId, timeoutBefore, timeoutAfter, id, autoRetry = true, inc = false }) {
  try {
    return await Mongo.withTransaction(async () => {
      console.log(`Transaction ${id} waiting before update ${timeoutBefore} ms`);

      const invoice = await Invoices.findOneAsync(invoiceId);
      console.log(`Transaction ${id} read total of ${invoice.total}`);

      await wait(timeoutBefore);
      console.log(`Transaction ${id} updating`);

      const modifier = inc ? {$inc: {total: 50}} : { $set: { total: invoice.total + 50 }};
      await Invoices.updateAsync(invoiceId, modifier);

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

  Tinytest.addAsync('update - replace, transaction successfully updates', async (test) => {
    await reset();

    const invoiceId = await Invoices.insertAsync({
      total: 100
    });

    const itemId = await InvoiceItems.insertAsync({
      total: 50,
      invoiceId
    });


    const result = await Mongo.withTransaction(async() => {
      await Invoices.find({}, {sort: {total: -1}}).fetchAsync();
      await Invoices.updateAsync(invoiceId, { total: 150 });
      await InvoiceItems.updateAsync(itemId, { invoiceId, total: 100, quantity: 2, thing: 'thing' });

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
      total: 100,
      thing: 'thing'
    })
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

      await Invoices.rawCollection().findOneAndUpdate(
        {_id: invoiceId},
        {$set: {total: 150}}
      );

      await Invoices.rawCollection().findOneAndUpdate(
        {_id: invoiceId},
        {$set: {total: 200}},
        {returnDocument: 'after'}
      );

      await Invoices.rawCollection().findOneAndReplace(
        {_id: invoiceId},
        {total: 250}
      );

      await Invoices.rawCollection().findOneAndReplace(
        {_id: invoiceId},
        {total: 300},
        {returnDocument: 'after'}
      );

      await Invoices.rawCollection().insertOne({ raw: true, total: 10 });

      const result = await Invoices.rawCollection().find({}, {limit: 5}).toArray();

      return result;
    });

    test.equal(result.length, 2);

    const invoices = await Invoices.find({}).fetchAsync();
    test.equal(invoices.length, 2)
    test.equal(invoices.filter(i => !i.raw)[0].total, 300)
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

  Tinytest.addAsync('rawCollection() - find', async (test) => {
    await reset();

    const result = await Mongo.withTransaction(async() => {
      const invoiceId = await Invoices.insertAsync({ raw: false, total: 100 });

      await Invoices.rawCollection().find();

      await Invoices.rawCollection().find(
        {_id: invoiceId}
      );

      const result = await Invoices.rawCollection().find(
        {_id: invoiceId},
        {limit: 1}
      ).toArray();

      return result;
    });

    test.equal(result.length, 1);
  });

  Tinytest.addAsync('rawCollection() - findOne', async (test) => {
    await reset();

    const result = await Mongo.withTransaction(async() => {
      const invoiceId = await Invoices.insertAsync({ raw: false, total: 100 });

      await Invoices.rawCollection().findOne();

      await Invoices.rawCollection().findOne(
        {_id: invoiceId}
      );

      const result = await Invoices.rawCollection().findOne(
        {_id: invoiceId},
        {maxTimeMS: 1000}
      )

      return result;
    });

    test.equal(typeof result._id, 'string');
  });

  Tinytest.addAsync('rawCollection() - insertOne', async (test) => {
    await reset();

    const result = await Mongo.withTransaction(async() => {
      await Invoices.rawCollection().insertOne(
        { raw: true, total: 100 }
      );

      const result = await Invoices.rawCollection().insertOne(
        { raw: true, total: 100 },
        { maxTimeMS: 1000 }
      );

      return result;
    });

    const invoices = await Invoices.find({}).fetchAsync();
    test.equal(invoices.length, 2);
  });

  Tinytest.addAsync('rawCollection() - insertMany', async (test) => { // TODO: fails in 2.X, works in 3.0
    await reset();

    const result = await Mongo.withTransaction(async() => {
      await Invoices.rawCollection().insertMany(
        [{ raw: true, total: 100 }, {raw: true, total: 10}]
      );

      const result = await Invoices.rawCollection().insertMany(
        [{ raw: true, total: 200 }, {raw: true, total: 20}],
        { maxTimeMS: 1000 }
      );

      return result;
    });

    const invoices = await Invoices.find({}).fetchAsync();
    test.equal(invoices.length, 4);
  });

  Tinytest.addAsync('rawCollection() - updateOne', async (test) => {
    await reset();

    const result = await Mongo.withTransaction(async() => {
      const invoiceId = await Invoices.insertAsync(
        { raw: true, total: 100 }
      );

      await Invoices.rawCollection().updateOne(
        { raw: false },
        { $set: { total: 200 }},
        { upsert: true }
      );

      const result = await Invoices.rawCollection().updateOne(
        { _id: invoiceId },
        { $set: { total: 25 }},
        { maxTimeMS: 1000 }
      );

      return result;
    });

    const invoices = await Invoices.find({}).fetchAsync();
    test.equal(invoices.length, 2);
    test.equal(invoices.map(i => i.total), [25, 200])
  });

  Tinytest.addAsync('rawCollection() - updateMany', async (test) => {
    await reset();

    const result = await Mongo.withTransaction(async() => {
      const invoiceId = await Invoices.insertAsync(
        { raw: true, total: 100 }
      );

      await Invoices.insertAsync(
        { raw: true, total: 50 }
      );

      const result = await Invoices.rawCollection().updateMany(
        { raw: true },
        { $set: { total: 25 }}
      );

      await Invoices.rawCollection().updateMany(
        { raw: true },
        { $set: { total: 10 }},
        { maxTimeMS: 1000 }
      );

      return result;
    });

    const invoices = await Invoices.find({}).fetchAsync();
    test.equal(invoices.map(i => i.total), [10, 10]);
  });

  Tinytest.addAsync('rawCollection() - replaceOne', async (test) => {
    await reset();

    const result = await Mongo.withTransaction(async() => {
      const invoiceId = await Invoices.insertAsync(
        { raw: true, total: 100 }
      );

      await Invoices.rawCollection().replaceOne(
        { raw: false },
        { total: 200 }
      );

      const result = await Invoices.rawCollection().replaceOne(
        { _id: invoiceId },
        { total: 20 },
        { maxTimeMS: 1000 }
      );

      return result;
    });

    const invoices = await Invoices.find({}).fetchAsync();
    test.equal(invoices.length, 1);
    test.equal(invoices[0].total, 20)
  });

  Tinytest.addAsync('rawCollection() - findOneAndUpdate', async (test) => {
    await reset();

    const result = await Mongo.withTransaction(async() => {
      const invoiceId = await Invoices.insertAsync(
        { raw: true, total: 100 }
      );

      await Invoices.rawCollection().findOneAndUpdate(
        { _id: invoiceId },
        { $set: { total: 25 }}
      );

      const result = await Invoices.rawCollection().findOneAndUpdate(
        { _id: invoiceId },
        { $set: { total: 50 }},
        { returnDocument: 'after' }
      );

      return result;
    });

    test.equal(result.value.total, 50);
  });

  Tinytest.addAsync('rawCollection() - findOneAndReplace', async (test) => {
    await reset();

    const result = await Mongo.withTransaction(async() => {
      const invoiceId = await Invoices.insertAsync(
        { raw: true, total: 100 }
      );

      await Invoices.rawCollection().findOneAndReplace(
        { _id: invoiceId },
        { total: 25 }
      );

      const result = await Invoices.rawCollection().findOneAndReplace(
        { _id: invoiceId },
        { total: 10 },
        { returnDocument: 'after' }
      );

      return result;
    });

    test.equal(result.value.total, 10);
  });

  Tinytest.addAsync('rawCollection() - findOneAndDelete', async (test) => {
    await reset();

    const result = await Mongo.withTransaction(async() => {
      const invoiceId = await Invoices.insertAsync(
        { raw: true, total: 100 }
      );

      const invoiceId2 = await Invoices.insertAsync(
        { raw: true, total: 200 }
      );

      const invoiceId3 = await Invoices.insertAsync(
        { raw: true, total: 300 }
      );

      await Invoices.rawCollection().findOneAndDelete(
        { _id: invoiceId }
      );

      const result = await Invoices.rawCollection().findOneAndDelete(
        { _id: invoiceId2 },
        { maxTimeMS: 1000 }
      );

      return result;
    });

    const invoices = await Invoices.find().fetchAsync();
    test.equal(invoices.length, 1);
  });

  Tinytest.addAsync('rawCollection() - deleteOne', async (test) => {
    await reset();

    const result = await Mongo.withTransaction(async() => {
      const invoiceId = await Invoices.insertAsync(
        { raw: true, total: 100 }
      );

      await Invoices.rawCollection().deleteOne();

      const invoiceId2 = await Invoices.insertAsync(
        { raw: true, total: 200 }
      );

      const invoiceId3 = await Invoices.insertAsync(
        { raw: true, total: 300 }
      );

      await Invoices.rawCollection().deleteOne(
        { _id: invoiceId }
      );

      await Invoices.rawCollection().deleteOne(
        { _id: invoiceId2 },
      );

      await Invoices.rawCollection().deleteOne(
        { _id: invoiceId3 },
        { maxTimeMS: 1000 }
      );

      return;
    });

    const invoices = await Invoices.find().fetchAsync();
    test.equal(invoices.length, 0);
  });

  Tinytest.addAsync('rawCollection() - deleteMany', async (test) => {
    await reset();

    const result = await Mongo.withTransaction(async() => {
      const invoiceId = await Invoices.insertAsync(
        { raw: true, total: 100 }
      );

      await Invoices.rawCollection().deleteMany();

      const invoiceId2 = await Invoices.insertAsync(
        { raw: true, total: 200 }
      );

      const invoiceId3 = await Invoices.insertAsync(
        { raw: true, total: 300 }
      );

      await Invoices.rawCollection().deleteMany(
        { raw: true }
      );

      await Invoices.insertAsync(
        { raw: true, total: 300 }
      );

      await Invoices.insertAsync(
        { raw: true, total: 200 }
      );

      await Invoices.insertAsync(
        { raw: false, total: 300 }
      );

      await Invoices.rawCollection().deleteMany(
        { raw: true },
        { maxTimeMS: 1000 }
      );

      return;
    });

    const invoices = await Invoices.find().fetchAsync();
    test.equal(invoices.length, 1);
    test.equal(invoices[0].raw, false);
  });

  Tinytest.addAsync('rawCollection() - bulkWrite', async (test) => { // TODO: fails in 2.X, works in 3.0
    await reset();

    const operations = [
      { insertOne: { document: { name: 'John', total: 30 } } },
      { insertOne: { document: { name: 'Alice', total: 25 } } },
      { insertOne: { document: { name: 'Bob', total: 35 } } },
      { deleteOne: { filter: { name: 'John' } } },
      { updateOne: { filter: { name: 'Alice' }, update: { $set: { total: 26 } } } }
    ];

    const operations2 = [
      { insertOne: { document: { name: 'Tim', total: 100 } } },
      { insertOne: { document: { name: 'Jane', total: 25 } } }
    ];

    const result = await Mongo.withTransaction(async() => {
      await Invoices.rawCollection().bulkWrite(operations)

      await Invoices.rawCollection().bulkWrite(operations2, { maxTimeMS: 1000 })
      return
    });

    const invoices = await Invoices.find().fetchAsync();
    test.equal(invoices.length, 4);
    test.equal(invoices.find(i => i.name === 'Alice').total, 26);
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

    if (Meteor.isFibersDisabled) { // TODO: not sure how to get this to match the same result in 2.X. in 3.0, when we wrap with the methodInvocation, it seems like they no longer run concurrently
      test.equal(invoices.length, 20);
      test.equal(items.length, 20);
    } else {
      test.equal(invoices.length, 10);
      test.equal(items.length, 10);
    }

    await callPromise('reset');
  }
});

async function runConcurrentTransactions(invoiceId, { autoRetry = true, timeoutBefore, timeoutAfter, inc = false } = {}) {
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
        timeoutBefore: timeoutBefore || 200,
        timeoutAfter: timeoutAfter || 2000,
        id: 1,
        autoRetry,
        inc,
      }),
      callWithConnectionPromise(conn2, 'updateInvoice', {
        invoiceId,
        timeoutBefore: timeoutBefore || 2000,
        timeoutAfter: timeoutAfter || 100,
        id: 2,
        autoRetry,
        inc
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

    const { invoices } = await callPromise('fetchInvoicesAndItems', {});
    test.equal(invoices.length, 1);

    const [ invoice ] = invoices;

    if (Meteor.isFibersDisabled) { // TODO: not sure how to get this to match the same result in 2.X. in 3.0, when we wrap with the methodInvocation, it seems like they no longer run concurrently. that might be a nice feature though.
      test.equal(invoice.total, 100);
    } else {
      test.equal(invoice.total, 150);
    }

    await callPromise('reset');
  }
});

Tinytest.addAsync('concurrency - exact the same time', async (test) => {
  if (Meteor.isClient) {
    const invoiceId = await callPromise('insertInvoiceNoTransaction', {total: 50});
    const [ res1, res2 ] = await runConcurrentTransactions(invoiceId, {timeoutBefore: 200, timeoutAfter: 200, inc: true});

    const { invoices } = await callPromise('fetchInvoicesAndItems', {});
    test.equal(invoices.length, 1);

    const [ invoice ] = invoices;
    test.equal(invoice.total, 150);

    await callPromise('reset');
  }
});

// TODO: in 3.0 when running inside a MethodInvocation, I wasn't able to get this to fail. in 3.0, when we wrap with the methodInvocation, it seems like they no longer run concurrently. that might be a nice feature though.
Tinytest.addAsync('concurrency - fails and gives WriteError when using Core API ({ autoRetry: false })', async (test) => {
  if (Meteor.isClient) {
    try {
      const invoiceId = await callPromise('insertInvoiceNoTransaction', {total: 50});
      const [ res1, res2 ] = await runConcurrentTransactions(invoiceId, { autoRetry: false, timeoutBefore: 200, timeoutAfter: 200 });

      const { invoices } = await callPromise('fetchInvoicesAndItems', {});
      if (!Meteor.isFibersDisabled) {
        test.equal('should not be reached', true);
      }
    } catch(error) {
      test.isTrue(error.message.includes('WriteConflict error'));
    } finally {
      await callPromise('reset');
    }
  }
});



