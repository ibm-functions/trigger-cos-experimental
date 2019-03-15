// Licensed to the Apache Software Foundation (ASF) under one or more contributor
// license agreements; and to You under the Apache License, Version 2.0.

var request = require('request');
var HttpStatus = require('http-status-codes');
var EventProvider = require('s3-trigger-feed');
var constants = require('./constants.js');
var authHandler = require('./authHandler');

module.exports = function(logger, triggerDB, redisClient) {

    var retryAttempts = constants.RETRY_ATTEMPTS;
    var filterDDName = constants.FILTERS_DESIGN_DOC;
    var viewDDName = constants.VIEWS_DESIGN_DOC;
    var triggersByWorker = constants.TRIGGERS_BY_WORKER;
    var redisKeyPrefix = process.env.REDIS_KEY_PREFIX || triggerDB.config.db;
    var self = this;

    this.triggers = {};
    this.endpointAuth = process.env.ENDPOINT_AUTH;
    this.routerHost = process.env.ROUTER_HOST || 'localhost';
    this.worker = process.env.WORKER || 'worker0';
    this.host = process.env.HOST_INDEX || 'host0';
    this.hostPrefix = this.host.replace(/\d+$/, '');
    this.activeHost = `${this.hostPrefix}0`; //default value on init (will be updated for existing redis)
    this.db = triggerDB;
    this.redisClient = redisClient;
    this.redisKey = redisKeyPrefix + '_' + this.worker;
    this.redisField = constants.REDIS_FIELD;

    this.eventProvider = new EventProvider({ fireTrigger, disableTrigger }, logger);

    function createTrigger (triggerData) {
        var method = 'createTrigger';

        const triggerIdentifier = triggerData.id;
        self.triggers[triggerIdentifier] = triggerData;

        self.eventProvider.add(triggerIdentifier, triggerData)
        .then(() => {
            logger.info(method, 'Added trigger', triggerData.id, 'to event provider');
        })
        .catch(err => {
            const message = 'Automatically disabled after receiving exception on init trigger: ' + err;
            disableTrigger(triggerIdentifier, undefined, message);
            logger.error(method, 'Disabled trigger', triggerIdentifier, 'due to exception:', err);
        });
    }

    function initTrigger(newTrigger) {

        var trigger = {
            id: newTrigger._id,
            apikey: newTrigger.apikey,
            additionalData: newTrigger.additionalData,
            bucket: newTrigger.bucket,
            interval: newTrigger.interval,
            s3_endpoint: newTrigger.s3_endpoint,
            s3_apikey: newTrigger.s3_apikey
        };

         return trigger;
    }

    function shouldDisableTrigger(statusCode) {
        return ((statusCode >= 400 && statusCode < 500) &&
            [HttpStatus.REQUEST_TIMEOUT, HttpStatus.TOO_MANY_REQUESTS, HttpStatus.CONFLICT].indexOf(statusCode) === -1);
    }

    function shouldFireTrigger() {
        return self.activeHost === self.host;
    }

    function disableTrigger(id, statusCode, message) {
        var method = 'disableTrigger';

        triggerDB.get(id, function (err, existing) {
            if (!err) {
                if (!existing.status || existing.status.active === true) {
                    var updatedTrigger = existing;
                    var status = {
                        'active': false,
                        'dateChanged': Date.now(),
                        'reason': {'kind': 'AUTO', 'statusCode': statusCode, 'message': message}
                    };
                    updatedTrigger.status = status;

                    triggerDB.insert(updatedTrigger, id, function (err) {
                        if (err) {
                            logger.error(method, 'there was an error while disabling', id, 'in database. ' + err);
                        }
                        else {
                            logger.info(method, 'trigger', id, 'successfully disabled in database');
                        }
                    });
                }
            }
            else {
                logger.info(method, 'could not find', id, 'in database');
                //make sure it is removed from memory as well
                deleteTrigger(id);
            }
        });
    }

    // Delete a trigger: stop listening for changes and remove it.
    function deleteTrigger(triggerIdentifier) {
        var method = 'deleteTrigger';

        if (self.triggers[triggerIdentifier]) {
            delete self.triggers[triggerIdentifier];

            self.eventProvider.remove(triggerIdentifier)
            .then(() => {
                logger.info(method, 'trigger', triggerIdentifier, 'successfully deleted');
            })
            .catch(err => {
                logger.error(method, err);
            });
        }
    }

    function fireTrigger(triggerIdentifier, event) {
        var method = 'fireTrigger';

        var triggerData = self.triggers[triggerIdentifier];

        if (triggerData && shouldFireTrigger()) {

            var triggerObj = parseQName(triggerData.id);

            logger.info(method, 'firing trigger', triggerData.id, 'with COS update');

            var host = 'https://' + self.routerHost;
            var uri = host + '/api/v1/namespaces/' + triggerObj.namespace + '/triggers/' + triggerObj.name;

            postTrigger(triggerData, event, uri, 0)
            .then(triggerId => {
                logger.info(method, 'Trigger', triggerId, 'was successfully fired');
            })
            .catch(err => {
                logger.error(method, err);
            });
        }
    }

    function postTrigger(triggerData, event, uri, retryCount) {
        var method = 'postTrigger';

        return new Promise(function(resolve, reject) {

            self.authRequest(triggerData, {
                method: 'post',
                uri: uri,
                json: event
            }, function(error, response) {
                try {
                    var statusCode = !error ? response.statusCode : error.statusCode;
                    logger.info(method, triggerData.id, 'http post request, STATUS:', statusCode);
                    if (error || statusCode >= 400) {
                        logger.error(method, 'there was an error invoking', triggerData.id, statusCode || error);
                        if (statusCode && shouldDisableTrigger(statusCode)) {
                            var message;
                            try {
                                message = error.error.errorMessage;
                            } catch (e) {
                                message = `Received a ${statusCode} status code when firing the trigger`;
                            }
                            disableTrigger(triggerData.id, statusCode, `Trigger automatically disabled: ${message}`);
                            reject(`Disabled trigger ${triggerData.id}: ${message}`);
                        }
                        else {
                            if (retryCount < retryAttempts ) {
                                var timeout = statusCode === 429 && retryCount === 0 ? 60000 : 1000 * Math.pow(retryCount + 1, 2);
                                logger.info(method, 'attempting to fire trigger again', triggerData.id, 'Retry Count:', (retryCount + 1));
                                setTimeout(function () {
                                    postTrigger(triggerData, uri, (retryCount + 1))
                                    .then(triggerId => {
                                        resolve(triggerId);
                                    })
                                    .catch(err => {
                                        reject(err);
                                    });
                                }, timeout);
                            } else {
                                reject('Unable to reach server to fire trigger ' + triggerData.id);
                            }
                        }
                    } else {
                        logger.info(method, 'fired', triggerData.id);
                        resolve(triggerData.id);
                    }
                }
                catch(err) {
                    reject('Exception occurred while firing trigger ' + err);
                }
            });
        });
    }

    this.initAllTriggers = function() {
        var method = 'initAllTriggers';

        //follow the trigger DB
        setupFollow('now');

        logger.info(method, 'resetting system from last state');
        triggerDB.view(viewDDName, triggersByWorker, {reduce: false, include_docs: true, key: self.worker}, function(err, body) {
            if (!err) {
                body.rows.forEach(function (trigger) {
                    var triggerIdentifier = trigger.id;
                    var doc = trigger.doc;

                    if (!(triggerIdentifier in self.triggers)) {
                        //check if trigger still exists in whisk db
                        var triggerObj = parseQName(triggerIdentifier);
                        var host = 'https://' + self.routerHost + ':' + 443;
                        var triggerURL = host + '/api/v1/namespaces/' + triggerObj.namespace + '/triggers/' + triggerObj.name;

                        logger.info(method, 'Checking if trigger', triggerIdentifier, 'still exists');
                        self.authRequest(doc, {
                            method: 'get',
                            url: triggerURL
                        }, function (error, response) {
                            //disable trigger in database if trigger is dead
                            if (!error && shouldDisableTrigger(response.statusCode)) {
                                var message = 'Automatically disabled after receiving a ' + response.statusCode + ' status code on init trigger';
                                disableTrigger(triggerIdentifier, response.statusCode, message);
                                logger.error(method, 'trigger', triggerIdentifier, 'has been disabled due to status code:', response.statusCode);
                            }
                            else {
                                createTrigger(initTrigger(doc));
                            }
                        });
                    }
                });
            } else {
                logger.error(method, 'could not get latest state from database', err);
            }
        });
    };

    function setupFollow(seq) {
        var method = 'setupFollow';

        try {
            var feed = triggerDB.follow({
                since: seq,
                include_docs: true,
                filter: filterDDName + '/' + triggersByWorker,
                query_params: {worker: self.worker}
            });

            feed.on('change', (change) => {
                var triggerIdentifier = change.id;
                var doc = change.doc;

                if (self.triggers[triggerIdentifier]) {
                    if (doc.status && doc.status.active === false) {
                        deleteTrigger(triggerIdentifier);
                    }
                }
                else {
                    //ignore changes to disabled triggers
                    if (!doc.status || doc.status.active === true) {
                         createTrigger(initTrigger(doc));
                    }
                }
            });

            feed.on('error', function (err) {
                logger.error(method, err);
            });

            feed.follow();
        }
        catch (err) {
            logger.error(method, err);
        }
    }

    this.authorize = function(req, res, next) {
        var method = 'authorize';

        if (self.endpointAuth) {
            if (!req.headers.authorization) {
                res.set('www-authenticate', 'Basic realm="Private"');
                res.status(HttpStatus.UNAUTHORIZED);
                return res.send('');
            }

            var parts = req.headers.authorization.split(' ');
            if (parts[0].toLowerCase() !== 'basic' || !parts[1]) {
                return sendError(method, HttpStatus.BAD_REQUEST, 'Malformed request, basic authentication expected', res);
            }

            var auth = new Buffer(parts[1], 'base64').toString();
            auth = auth.match(/^([^:]*):(.*)$/);
            if (!auth) {
                return sendError(method, HttpStatus.BAD_REQUEST, 'Malformed request, authentication invalid', res);
            }

            var uuid = auth[1];
            var key = auth[2];
            var endpointAuth = self.endpointAuth.split(':');
            if (endpointAuth[0] === uuid && endpointAuth[1] === key) {
                next();
            }
            else {
                logger.warn(method, 'Invalid key');
                return sendError(method, HttpStatus.UNAUTHORIZED, 'Invalid key', res);
            }
        }
        else {
            next();
        }
    };

    function sendError(method, code, message, res) {
        logger.error(method, message);
        res.status(code).json({error: message});
    }

    function parseQName(qname, separator) {
        var parsed = {};
        var delimiter = separator || '/';
        var defaultNamespace = '_';
        if (qname && qname.charAt(0) === delimiter) {
            var parts = qname.split(delimiter);
            parsed.namespace = parts[1];
            parsed.name = parts.length > 2 ? parts.slice(2).join(delimiter) : '';
        } else {
            parsed.namespace = defaultNamespace;
            parsed.name = qname;
        }
        return parsed;
    }

    this.initRedis = function() {
        var method = 'initRedis';

        return new Promise(function(resolve, reject) {

            if (redisClient) {
                var subscriber = redisClient.duplicate();

                //create a subscriber client that listens for requests to perform swap
                subscriber.on('message', function (channel, message) {
                    logger.info(method, message, 'set to active host in channel', channel);
                    self.activeHost = message;
                });

                subscriber.on('error', function (err) {
                    logger.error(method, 'Error connecting to redis', err);
                    reject(err);
                });

                subscriber.subscribe(self.redisKey);

                redisClient.hgetAsync(self.redisKey, self.redisField)
                .then(activeHost => {
                    return initActiveHost(activeHost);
                })
                .then(() => {
                    process.on('SIGTERM', function onSigterm() {
                        if (self.activeHost === self.host) {
                            var redundantHost = self.host === `${self.hostPrefix}0` ? `${self.hostPrefix}1` : `${self.hostPrefix}0`;
                            self.redisClient.hsetAsync(self.redisKey, self.redisField, redundantHost)
                            .then(() => {
                                self.redisClient.publish(self.redisKey, redundantHost);
                            })
                            .catch(err => {
                                logger.error(method, err);
                            });
                        }
                    });
                    resolve();
                })
                .catch(err => {
                    reject(err);
                });
            }
            else {
                resolve();
            }
        });
    };

    function initActiveHost(activeHost) {
        var method = 'initActiveHost';

        if (activeHost === null) {
            //initialize redis key with active host
            logger.info(method, 'redis hset', self.redisKey, self.redisField, self.activeHost);
            return redisClient.hsetAsync(self.redisKey, self.redisField, self.activeHost);
        }
        else {
            self.activeHost = activeHost;
            return Promise.resolve();
        }
    }

    this.authRequest = function(triggerData, options, cb) {
        var method = 'authRequest';

        authHandler.handleAuth(triggerData, options)
        .then(requestOptions => {
            request(requestOptions, cb);
        })
        .catch(err => {
            logger.error(method, err);
            cb(err);
        });
    };

};
