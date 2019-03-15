#!/bin/bash

# Licensed to the Apache Software Foundation (ASF) under one or more contributor
# license agreements; and to You under the Apache License, Version 2.0.

#
# use the command line interface to install standard actions deployed
# automatically
#
# To run this command
# ./installCatalog.sh <authkey> <edgehost> <dburl> <dbprefix> <apihost> <workers>

set -e
set -x

: ${OPENWHISK_HOME:?"OPENWHISK_HOME must be set and non-empty"}
WSK_CLI="$OPENWHISK_HOME/bin/wsk"

if [ $# -eq 0 ]; then
    echo "Usage: ./installCatalog.sh <authkey> <edgehost> <dburl> <dbprefix> <apihost> <workers>"
fi

AUTH="$1"
EDGEHOST="$2"
DB_URL="$3"
DB_NAME="${4}costrigger"
APIHOST="$5"
WORKERS="$6"
ACTION_RUNTIME_VERSION=${ACTION_RUNTIME_VERSION:="nodejs:10"}

# If the auth key file exists, read the key in the file. Otherwise, take the
# first argument as the key itself.
if [ -f "$AUTH" ]; then
    AUTH=`cat $AUTH`
fi

# Make sure that the EDGEHOST is not empty.
: ${EDGEHOST:?"EDGEHOST must be set and non-empty"}

# Make sure that the DB_URL is not empty.
: ${DB_URL:?"DB_URL must be set and non-empty"}

# Make sure that the DB_NAME is not empty.
: ${DB_NAME:?"DB_NAME must be set and non-empty"}

# Make sure that the APIHOST is not empty.
: ${APIHOST:?"APIHOST must be set and non-empty"}

PACKAGE_HOME="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

export WSK_CONFIG_FILE= # override local property file to avoid namespace clashes

echo Installing COS Provider package.

$WSK_CLI -i --apihost "$EDGEHOST" package update --auth "$AUTH" --shared yes cos-experimental \
    -a description "COS Provider service" \
    -p apihost "$APIHOST"

# make cosFeed.zip
cd action

if [ -e cosFeed.zip ]; then
    rm -rf cosFeed.zip
fi

cp -f cosFeed_package.json package.json
zip -r cosFeed.zip lib package.json cos.js

$WSK_CLI -i --apihost "$EDGEHOST" action update --kind "$ACTION_RUNTIME_VERSION" --auth "$AUTH" cos-experimental/changes "$PACKAGE_HOME/action/cosFeed.zip" \
    -a feed true \
    -a provide-api-key true \
    -a description 'Event provider COS feed' \
    -a parameters '[ {"name":"apikey", "required":true},  {"name":"endpoint", "required":true}, {"name":"bucket", "required":true}, {"name":"interval", "required":false} ]'


COMMAND=" -i --apihost $EDGEHOST package update --auth $AUTH --shared no cosWeb \
     -p DB_URL $DB_URL \
     -p DB_NAME $DB_NAME \
     -p apihost $APIHOST"

if [ -n "$WORKERS" ]; then
    COMMAND+=" -p workers $WORKERS"
fi

$WSK_CLI $COMMAND

# make cosWebAction.zip
cp -f cosWeb_package.json package.json

if [ -e cosWebAction.zip ]; then
    rm -rf cosWebAction.zip
fi

zip -r cosWebAction.zip lib package.json cosWebAction.js

$WSK_CLI -i --apihost "$EDGEHOST" action update --kind "$ACTION_RUNTIME_VERSION" --auth "$AUTH" cosWeb/cosWebAction "$PACKAGE_HOME/action/cosWebAction.zip" \
    -a description 'Create/Delete Event triggers in COS provider database' \
    --web true
