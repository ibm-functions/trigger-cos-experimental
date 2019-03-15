// Licensed to the Apache Software Foundation (ASF) under one or more contributor
// license agreements; and to You under the Apache License, Version 2.0.

var si = require('systeminformation');
var v8 = require('v8');
var _ = require('lodash');

module.exports = function(logger, triggerManager) {

    // Health Endpoint
    this.endPoint = '/health';

    // Health Logic
    this.health = function (req, res) {

        var stats = {triggerCount: Object.keys(triggerManager.triggers).length};

        // get all system stats in parallel
        Promise.all([
            si.mem(),
            si.currentLoad(),
            si.fsSize(),
            si.networkStats(),
            si.inetLatency(triggerManager.routerHost)
        ])
        .then(results => {
            stats.memory = results[0];
            stats.cpu = _.omit(results[1], 'cpus');
            stats.disk = results[2];
            stats.network = results[3];
            stats.apiHostLatency = results[4];
            stats.heapStatistics = v8.getHeapStatistics();
            res.send(stats);
        })
        .catch(error => {
            stats.error = error;
            res.send(stats);
        });
    };

};
