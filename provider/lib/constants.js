// Licensed to the Apache Software Foundation (ASF) under one or more contributor
// license agreements; and to You under the Apache License, Version 2.0.

const TRIGGER_DB_SUFFIX = 'costrigger';
const RETRY_ATTEMPTS = 10;
const REDIS_FIELD = 'active';
const FILTERS_DESIGN_DOC = 'triggerFilters';
const VIEWS_DESIGN_DOC = 'triggerViews';
const TRIGGERS_BY_WORKER = 'triggers_by_worker';


module.exports = {
    TRIGGER_DB_SUFFIX: TRIGGER_DB_SUFFIX,
    RETRY_ATTEMPTS: RETRY_ATTEMPTS,
    REDIS_FIELD: REDIS_FIELD,
    FILTERS_DESIGN_DOC: FILTERS_DESIGN_DOC,
    VIEWS_DESIGN_DOC: VIEWS_DESIGN_DOC,
    TRIGGERS_BY_WORKER: TRIGGERS_BY_WORKER
};
