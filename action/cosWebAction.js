// Licensed to the Apache Software Foundation (ASF) under one or more contributor
// license agreements; and to You under the Apache License, Version 2.0.

const _ = require('lodash');
const moment = require('moment');
const common = require('./lib/common');
const Database = require('./lib/Database');

const feedParameters = [ 'bucket', 'endpoint', 'apikey', 'interval' ];
const dbParameters = ['bucket', 's3_endpoint', 's3_apikey', 'interval'];

function main(params) {

    if (!params.triggerName) {
        return common.sendError(400, 'no trigger name parameter was provided');
    }

    var triggerParts = common.parseQName(params.triggerName);
    var triggerData = {
        apikey: params.authKey,
        name: triggerParts.name,
        namespace: triggerParts.namespace,
        additionalData: common.constructObject(params.additionalData)
    };
    var triggerID = `/${triggerParts.namespace}/${triggerParts.name}`;

    var workers = params.workers instanceof Array ? params.workers : [];
    const db = new Database(params.DB_URL, params.DB_NAME);

    if (params.__ow_method === "post") {
        return new Promise(function (resolve, reject) {

            const newTrigger = {
                apikey: triggerData.apikey,
                maxTriggers: -1,
                status: {
                    'active': true,
                    'dateChanged': Date.now()
                },
                additionalData: triggerData.additionalData
            };

            common.verifyTriggerAuth(triggerData, false)
            .then(() => validateParams(params, {}, feedParameters))
            .catch(err => {
                return reject(common.sendError(400, `COS trigger feed validation failed`, err.message));
             })
            .then(validParams => {
                Object.assign(newTrigger, validParams);
                return db.getWorkerID(workers);
            })
            .then((worker) => {
                console.log('trigger will be assigned to worker ' + worker);
                newTrigger.worker = worker;
                return db.createTrigger(triggerID, newTrigger);
            })
            .then(() => resolve(common.sendResponse()))
            .catch(reject);
        });
    }
    else if (params.__ow_method === "get") {
        return new Promise(function (resolve, reject) {
            common.verifyTriggerAuth(triggerData, false)
            .then(() => db.getTrigger(triggerID))
            .then(doc => {

                var body = {
                    config: {
                        name: doc._id.split(':')[2],
                        namespace: doc._id.split(':')[1],
                        bucket: doc.bucket,
                        endpoint: doc.s3_endpoint,
                        apikey: doc.s3_apikey,
                        interval: doc.interval
                    },
                    status: {
                        active: doc.status.active,
                        dateChanged: moment(doc.status.dateChanged).utc().valueOf(),
                        dateChangedISO: moment(doc.status.dateChanged).utc().format(),
                        reason: doc.status.reason
                    }
                };
                resolve(common.sendResponse(200, body));
            })
            .catch(reject);
        });
    }
    else if (params.__ow_method === "put") {

        return new Promise(function (resolve, reject) {
            var updatedParams;
            var originalTrigger;

            common.verifyTriggerAuth(triggerData, false)
            .then(() => db.getTrigger(triggerID))
            .then(trigger => {
                if (trigger.status && trigger.status.active === false) {
                    return reject(common.sendError(400, `${params.triggerName} cannot be updated because it is disabled`));
                }
                originalTrigger = trigger;
                return validateParams(params, _.pick(originalTrigger, dbParameters));
            })
            .catch(err => {
                return reject(common.sendError(400, `COS trigger feed validation failed`, err.message));
            })
            .then(validParams => {
                updatedParams = validParams;
                return db.disableTrigger(triggerID, originalTrigger, 0, 'updating');
            })
            .then(triggerID => db.getTrigger(triggerID))
            .then(trigger => db.updateTrigger(triggerID, trigger, updatedParams, 0))
            .then(() => resolve(common.sendResponse()))
            .catch(reject);
        });
    }
    else if (params.__ow_method === "delete") {

        return new Promise(function (resolve, reject) {
            common.verifyTriggerAuth(triggerData, true)
            .then(() => db.getTrigger(triggerID))
            .then(trigger => db.disableTrigger(triggerID, trigger, 0, 'deleting'))
            .then(triggerID => db.deleteTrigger(triggerID, 0))
            .then(() => resolve(common.sendResponse()))
            .catch(reject);
        });
    }
    else {
        return common.sendError(400, 'unsupported lifecycleEvent');
    }
}

async function validateParams(params, valid, expectedParams) {

    if (expectedParams) {
        for (let param of expectedParams) {
            if (!params.hasOwnProperty(param)) {
                throw new Error(`missing ${param} parameter`);
            }
            valid[verifiedParam(param)] = params[param];
        }
    }
    else {
        var hasUpdate = false;
        for (let param in params) {
            try {
                valid[verifiedParam(param)] = params[param];
                hasUpdate = true;
            }
            catch(err) {
                console.log(err);
            }
        }
        if (!hasUpdate) {
            throw new Error(`no updatable parameters were specified`);
        }
    }

    if (valid.interval < 1 || !Number.isInteger(valid.interval)) {
        throw new Error(`invalid interval parameter`);
    }

    const client = require('ibm-cos-sdk').S3;
    const s3 = new client({
        endpoint: valid.s3_endpoint, apiKeyId: valid.s3_apikey
    });

    try {
        await s3.listObjects({ Bucket: valid.bucket, MaxKeys: 0 }).promise();
        return valid;
    } catch (err) {
        const message = formatError(err);
        throw new Error(message);
    }

}

function verifiedParam(param) {

    switch (param) {
        case 'apikey':
            return 's3_apikey';
        case 'endpoint':
            return 's3_endpoint';
        case 'bucket':
        case 'interval':
            return param;
        default:
            throw new Error(`${param} is not an updatable parameter`);
    }
}

function formatError(err) {
    const msg = err.message || 'unknown';
    const code = err.code || 'unknown';
    const response = `code: ${code}, message: ${msg}`;
    return `COS trigger feed: error returned accessing bucket => (${response})`;
}


exports.main = main;