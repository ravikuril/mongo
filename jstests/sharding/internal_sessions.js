/*
 * Tests basic support for internal sessions.
 *
 * @tags: [requires_fcv_51, featureFlagInternalTransactions]
 */
(function() {
'use strict';

TestData.disableImplicitSessions = true;

const st = new ShardingTest({
    shards: 1,
    mongosOptions: {setParameter: {maxSessions: 1}},
    shardOptions: {setParameter: {maxSessions: 1}}
});
const shard0Primary = st.rs0.getPrimary();

const kDbName = "testDb";
const kCollName = "testColl";
const testDB = st.s.getDB(kDbName);

const kConfigTxnNs = "config.transactions";
const kConfigSessionNs = "config.system.sessions";

(() => {
    // Verify that internal sessions are only supported in transactions.
    const sessionUUID = UUID();

    jsTest.log(
        "Test running an internal session with lsid containing txnNumber and stmtId outside transaction");
    const lsid1 = {id: sessionUUID, txnNumber: NumberLong(35), stmtId: NumberInt(0)};
    assert.commandFailedWithCode(testDB.runCommand({
        insert: kCollName,
        documents: [{x: 1}],
        lsid: lsid1,
    }),
                                 ErrorCodes.InvalidOptions);
    assert.commandFailedWithCode(testDB.runCommand({
        insert: kCollName,
        documents: [{x: 1}],
        lsid: lsid1,
        txnNumber: NumberLong(0),
    }),
                                 ErrorCodes.InvalidOptions);

    jsTest.log(
        "Test running an internal session with with lsid containing txnUUID outside transaction");
    const lsid2 = {id: sessionUUID, txnUUID: UUID()};
    assert.commandFailedWithCode(testDB.runCommand({
        insert: kCollName,
        documents: [{x: 2}],
        lsid: lsid1,
    }),
                                 ErrorCodes.InvalidOptions);
    assert.commandFailedWithCode(testDB.runCommand({
        insert: kCollName,
        documents: [{x: 2}],
        lsid: lsid2,
        txnNumber: NumberLong(35),
    }),
                                 ErrorCodes.InvalidOptions);

    assert.eq(0, shard0Primary.getCollection(kConfigTxnNs).count({"_id.id": sessionUUID}));
    assert.commandWorked(shard0Primary.adminCommand({refreshLogicalSessionCacheNow: 1}));
    assert.eq(0, shard0Primary.getCollection(kConfigSessionNs).count({"_id.id": sessionUUID}));
})();

(() => {
    jsTest.log("Test that the only supported child lsid formats are txnNumber+stmtId, and txnUUID");

    const sessionUUID = UUID();

    assert.commandFailedWithCode(testDB.runCommand({
        insert: kCollName,
        documents: [{x: 1}],
        lsid: {id: sessionUUID, txnNumber: NumberLong(35)},
        txnNumber: NumberLong(0),
        startTransaction: true,
        autocommit: false
    }),
                                 ErrorCodes.InvalidOptions);
    assert.commandFailedWithCode(testDB.runCommand({
        insert: kCollName,
        documents: [{x: 1}],
        lsid: {id: sessionUUID, stmtId: NumberInt(0)},
        txnNumber: NumberLong(0),
        startTransaction: true,
        autocommit: false
    }),
                                 ErrorCodes.InvalidOptions);
    assert.commandFailedWithCode(testDB.runCommand({
        insert: kCollName,
        documents: [{x: 1}],
        lsid: {id: sessionUUID, txnUUID: UUID(), stmtId: NumberInt(0)},
        txnNumber: NumberLong(0),
        startTransaction: true,
        autocommit: false
    }),
                                 ErrorCodes.InvalidOptions);
    assert.commandFailedWithCode(testDB.runCommand({
        insert: kCollName,
        documents: [{x: 1}],
        lsid: {id: sessionUUID, txnNumber: NumberLong(35), txnUUID: UUID()},
        txnNumber: NumberLong(0),
        startTransaction: true,
        autocommit: false
    }),
                                 ErrorCodes.InvalidOptions);
    assert.commandFailedWithCode(testDB.runCommand({
        insert: kCollName,
        documents: [{x: 1}],
        lsid: {id: sessionUUID, txnNumber: NumberLong(35), txnUUID: UUID(), stmtId: NumberInt(0)},
        txnNumber: NumberLong(0),
        startTransaction: true,
        autocommit: false
    }),
                                 ErrorCodes.InvalidOptions);

    assert.eq(0, shard0Primary.getCollection(kConfigTxnNs).count({"_id.id": sessionUUID}));
    assert.commandWorked(shard0Primary.adminCommand({refreshLogicalSessionCacheNow: 1}));
    assert.eq(0, shard0Primary.getCollection(kConfigSessionNs).count({"_id.id": sessionUUID}));
})();

(() => {
    // Verify that parent and child sessions are tracked using different config.transactions
    // documents but are tracked as one logical session (i.e. using the same config.system.sessions
    // document).
    const sessionUUID = UUID();

    const lsid0 = {id: sessionUUID};
    assert.commandWorked(testDB.runCommand(
        {insert: kCollName, documents: [{x: 0}], lsid: lsid0, txnNumber: NumberLong(0)}));
    assert.neq(null, shard0Primary.getCollection(kConfigTxnNs).findOne({"_id.id": sessionUUID}));

    const minLastUse = new Date();
    sleep(1000);

    // Starting an unrelated session should fail since the cache size is 1.
    assert.commandFailedWithCode(
        testDB.runCommand(
            {insert: kCollName, documents: [{x: 0}], lsid: {id: UUID()}, txnNumber: NumberLong(0)}),
        ErrorCodes.TooManyLogicalSessions);

    // Starting child sessions should succeed since parent and child sessions are tracked as one
    // logical session.
    jsTest.log("Test running an internal transaction with lsid containing txnNumber and stmtId");
    const lsid1 = {id: sessionUUID, txnNumber: NumberLong(35), stmtId: NumberInt(0)};
    const txnNumber1 = NumberLong(0);
    assert.commandWorked(testDB.runCommand({
        insert: kCollName,
        documents: [{x: 1}],
        lsid: lsid1,
        txnNumber: txnNumber1,
        startTransaction: true,
        autocommit: false
    }));
    assert.commandWorked(testDB.adminCommand(
        {commitTransaction: 1, lsid: lsid1, txnNumber: txnNumber1, autocommit: false}));
    assert.neq(null, shard0Primary.getCollection(kConfigTxnNs).findOne({
        "_id.id": sessionUUID,
        "_id.txnNumber": lsid1.txnNumber,
        "_id.stmtId": lsid1.stmtId
    }));

    jsTest.log("Test running an internal transaction with lsid containing txnUUID");
    const lsid2 = {id: sessionUUID, txnUUID: UUID()};
    const txnNumber2 = NumberLong(35);
    assert.commandWorked(testDB.runCommand({
        insert: kCollName,
        documents: [{x: 2}],
        lsid: lsid2,
        txnNumber: txnNumber2,
        startTransaction: true,
        autocommit: false
    }));
    assert.commandWorked(testDB.adminCommand(
        {commitTransaction: 1, lsid: lsid2, txnNumber: txnNumber2, autocommit: false}));
    assert.neq(null,
               shard0Primary.getCollection(kConfigTxnNs)
                   .findOne({"_id.id": sessionUUID, "_id.txnUUID": lsid2.txnUUID}));

    assert.eq(3, shard0Primary.getCollection(kConfigTxnNs).count({"_id.id": sessionUUID}));
    assert.commandWorked(shard0Primary.adminCommand({refreshLogicalSessionCacheNow: 1}));
    const sessionDocs =
        shard0Primary.getCollection(kConfigSessionNs).find({"_id.id": sessionUUID}).toArray();
    assert.eq(sessionDocs.length, 1);
    assert(!sessionDocs[0]._id.hasOwnProperty("txnTxnNumber"), tojson(sessionDocs[0]));
    assert(!sessionDocs[0]._id.hasOwnProperty("txnUUID"), tojson(sessionDocs[0]));
    assert(!sessionDocs[0]._id.hasOwnProperty("stmtId"), tojson(sessionDocs[0]));
    assert.gte(sessionDocs[0].lastUse, minLastUse, tojson(sessionDocs[0]));
})();

st.stop();
})();
