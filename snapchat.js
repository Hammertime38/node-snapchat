/**
 *@license
 * Copyright 2013 Lucas A. Dohring
 *
 * Licensed under the EUPL, Version 1.1 or – as soon they
 * will be approved by the European Commission - subsequent
 * versions of the EUPL (the "Licence");
 *
 * You may not use this work except in compliance with the
 * Licence.
 *
 * You may obtain a copy of the Licence at:
 * http://ec.europa.eu/idabc/eupl
 *
 * Unless required by applicable law or agreed to in
 * writing, software distributed under the Licence is
 * distributed on an "AS IS" basis,
 *
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied.
 *
 * See the Licence for the specific language governing
 * permissions and limitations under the Licence.
 */


var crypto = require('crypto'),
    FormStream = require('multipart-form-stream'),
    Promise = require('bluebird'),
    util = require('util'),
    https = require('https'),
    spawn = require("child_process").spawn,
    uuid = require("uuid-v4"),
    fs = require('fs'),
    qs = require('querystring'),
    rp = require('request-promise');

var e = module.exports;
/** @const */
var blob_enc_key = e.blob_enc_key = Buffer('4d3032636e5135314a69393776775434', 'hex');
/** @const */
var pattern = e.hash_pattern = "0001110111101110001111010101111011010001001110011000110001000110";
/** @const */
var secret = e.secret = "iEk21fuwZApXlz93750dmW22pw389dPwOk";
/** @const */
var static_token = e.static_token = "m198sOkJEn37DjqZ32lpRu76xmw288xSQ9";
/** @const */
var hostname = e.hostname = "feelinsonice-hrd.appspot.com";
/** @const */
// var user_agent = e.user_agent = 'Snapchat/9.0.2.1 Beta (ALCATEL ONE TOUCH 6040D; Android 17; gzip)';
// Fix Vervion to 8.1.2
var user_agent = e.user_agent = 'Snapchat/8.1.2 (GT-I9505; Android 19; gzip)';

var sink = require("stream-sink");

e.hash = function hash(param1, param2) {
    var s1 = secret + param1;
    var s2 = param2 + secret;

    var hash = crypto.createHash('sha256');
    hash.update(s1, 'binary');
    var h1 = hash.digest('hex');

    var hash = crypto.createHash('sha256');
    hash.update(s2, 'binary');
    var h2 = hash.digest('hex');

    var out = '';
    for (var i = 0, len = pattern.length; i < len; ++i) {
        if (pattern[i] == '0') out += h1[i];
        else out += h2[i];
    }
    return out;
};



/** @const */
e.MEDIA_IMAGE = 0;
/** @const */
e.MEDIA_VIDEO = 1;

/**
 * Make a post call and sign it with a req_token.
 * @param  {String}       endpoint  The endpoint to call
 * @param  {Object}       post_data Data
 * @param  {String}       param1    Usually the auth_token
 * @param  {String}       param2    Usually the timestamp
 * @param  {Boolean=false} raw      If true, return a stream instead of a string. The stream will be paused to avoid data loss.
 * @return {Promise}
 */
e.postCall = function postCall(endpoint, post_data, auth_token, ts) {

    if (auth_token) {
        post_data.req_token = e.hash(auth_token, ts);
    };
    var data = qs.stringify(post_data);
    var opts = {
        uri: "https://" + hostname + endpoint,
        method: 'POST',
        // json: true,
        // path: endpoint,
        form: post_data,
        resolveWithFullResponse: false,
        headers: {
            'Accept-Language': 'en',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': data.length,
            'User-Agent': e.user_agent,
            'Accept-Locale': 'en_US',
            'accept-encoding': 'identity',
            // 'Accept': '*/*'
            // 'accept-encoding': 'identity'
        }
    };

    return rp(opts);


};

/**
 * Login and get auth_token
 * @param  {String}  username
 * @param  {String}  password
 * @return {Promise} sync data
 */
e.login = function login(username, password) {
    var ts = Date.now().toString();
    return e.postCall('/loq/login', {
            username: username,
            password: password,
            timestamp: ts
        }, static_token, ts)
        .catch(function(res) {
            return Promise.reject(res);
        })
        .then(function(data) {
            console.log(data);

            return JSON.parse(data);
        })

};

/**
 * Get current state and optionally update it
 * @param  {String}  username
 * @param  {String}  auth_token
 * @param  {Object}  json        An object countaining fields to update.
 * @return {Promise} The current state
 */
e.sync = function(username, auth_token, json) {
    var ts = Date.now().toString();
    return e.postCall('/loq/all_updates', {
            username: username,
            timestamp: ts,
            // json: JSON.stringify(json || {}),
            auth_token: auth_token
        }, auth_token, ts)
        .then(function(data) {
            return JSON.parse(data);
        });
};

/**
 * Fetch blob
 * @param  {String}  username
 * @param  {String}  auth_token
 * @param  {String}  id
 * @return {Promise} Readable stream
 */
e.getBlob = function(username, auth_token, id) {
    var ts = Date.now().toString(),
        // Decrypt 
        decrypt = crypto.createDecipheriv('aes-128-ecb', blob_enc_key, '');

    // Return decrypted stream
    // stream =
    return e.postCall('/ph/blob', {
            id: id, // ID snap
            timestamp: ts, // Timestamp
            username: username, // User name
        }, auth_token, ts)
        .pipe(decrypt) // Decrypt stream
        .on('error', console.dir)

    // return fs.createReadStream(stream.path);

};

/**
 * Upload a snap
 * @param  {String}  username
 * @param  {String}  auth_token
 * @param  {Stream}  stream A readable stream for the snap.
 * @param  {Boolean} isVideo
 * @return {Promise} The blob's mediaId.
 */
e.upload = function upload(username, auth_token, stream, isVideo) {
    var ts = '' + Date.now();
    isVideo = Number(!!isVideo);

    var mediaId = (username + '~' + uuid()).toUpperCase();
    var encrypt = spawn('openssl', ['enc', '-K', '4d3032636e5135314a69393776775434', '-aes-128-ecb']);
    encrypt.stdout.pause();
    stream.pipe(encrypt.stdin);

    var form = new FormStream();
    var req_token = e.hash(auth_token, ts);
    form.addField('req_token', req_token);
    form.addField('timestamp', ts);
    form.addStream('data', 'media', 'application/octet-stream', encrypt.stdout);
    form.addField('username', username);
    form.addField('media_id', mediaId);
    form.addField('type', isVideo);
    return new Promise(function(resolve, reject) {
        var req = https.request({
            host: hostname,
            method: 'POST',
            path: '/ph/upload',
            headers: {
                'Content-type': 'multipart/form-data; boundary=' + form.getBoundary(),
                'User-Agent': user_agent,
            }
        }, function(res) {
            res.setEncoding('ascii');
            res.pipe(sink().on('data', function(data) {
                if (res.statusCode != 200) return reject(data);
                resolve(mediaId);
            }));
        });
        form.on('data', function(data) {
            req.write(data);
        }).on('end', function(end) {
            req.end(end);
        })
    })
}



e.retry_post_story = function upload(username, auth_token, stream, isVideo) {
    var ts = '' + Date.now();
    isVideo = Number(!!isVideo);

    var mediaId = (username + uuid()).toUpperCase();
    var encrypt = spawn('openssl', ['enc', '-K', '4d3032636e5135314a69393776775434', '-aes-128-ecb']);
    encrypt.stdout.pause();
    stream.pipe(encrypt.stdin);

    var form = new FormStream();
    var req_token = e.hash(auth_token, ts);
    form.addField('req_token', req_token);
    form.addField('timestamp', ts);
    form.addStream('data', 'media', 'application/octet-stream', encrypt.stdout);
    form.addField('username', username);
    form.addField('media_id', mediaId);
    form.addField('type', isVideo);

    return new Pomise(function(resolve, reject) {
        var req = https.request({
            host: hostname,
            method: 'POST',
            path: '/bq/retry_post_story',
            headers: {
                'Content-type': 'multipart/form-data; boundary=SuperSweetSpecialBoundaryShabam',
                'User-Agent': user_agent,
            }
        }, function(res) {
            res.setEncoding('ascii');
            res.pipe(sink().on('data', function(data) {
                if (res.statusCode != 200) return reject(data);
                resolve(mediaId);
            }));
        });
        form.on('data', function(data) {
            req.write(data);
        }).on('end', function(end) {
            req.end(end);
        });
    });;
};


/**
 * Send a blob to a friend.
 * @param  {String}  username
 * @param  {String}  auth_token
 * @param  {String}  mediaId    A unique identifyer for the blob generated by @link upload
 * @param  {Array}   friends    An array of friends to send the snap to.
 * @return {Promise}
 */
e.send = function send(username, auth_token, mediaId, friends, time) {
    var ts = Date.now().toString();

    var postData = {
        username: username,
        recipient: friends,
        media_id: mediaId,
        timestamp: ts
    };
    if (typeof time != 'undefined') postData.time = time;
    return e.postCall('/ph/send', postData, auth_token, ts);
};


/**
 * Send a blob to a friend.
 * @param  {String}  username
 * @param  {String}  auth_token
 * @param  {String}  mediaId    A unique identifyer for the blob generated by @link upload
 * @param  {Array}   friends    An array of friends to send the snap to.
 * @return {Promise}
 */
e.findFriends = function findFriends(username, auth_token) {
    var ts = Date.now().toString();

    var n = '{"14389908240":"Sara"}';
    // JSON.parse(n);
    var postData = {
        username: username,
        timestamp: ts,
        countryCode: 'CI',
        numbers: n
    };
    if (typeof time != 'undefined') postData.time = time;
    return e.postCall('/ph/find_friends', postData, auth_token, ts).catch(console.dir);
};


/**
 * Get Stories
 * @param  {String}  username
 * @param  {String}  auth_token
 * @return {Promise}
 */
e.getStories = function getStories(username, auth_token) {
    var ts = Date.now() + '';
    var postData = {
        username: username,
        timestamp: ts
    };
    return e.postCall('/bq/stories', postData, auth_token, ts);
};

/**
 * Mark snap viewed
 * @param  {int}     Id snap
 * @param  {String}  username
 * @param  {String}  auth_token
 * @return {Promise}
 */
e.markSnapViewed = function markSnapViewed(snap_id, username, auth_token) {

    var ts = Date.now().toString();

    // Time viewed video
    var t = Date.now() - 30;

    //  A string representation of a dictionary of snap

    var snaps_json = '{ "' + snap_id + '":{ "replayed":0, "c": 0,"t": ' + ts + ' }}';

    // A string representation of a lis  of updates 
    events_json = '[ { "eventName" : "SNAP_VIEW", "params" : { "id" : "' + snap_id + '" }, "ts" : ' + t + ' }, { "eventName": "SNAP_EXPIRED", "params" : { "id": "' + snap_id + '" }, "ts" : ' + ts + ' } ]'

    var postData = {
        username: username,
        json: snaps_json,
        events: events_json,
        timestamp: ts
    };
    return e.postCall('/bq/update_snaps', postData, auth_token, ts);
};


/**
 * Post a Story
 * @param  {String}  username
 * @param  {String}  auth_token
 * @param  {String}  mediaId       A unique identifyer for the blob generated by @link upload
 * @param  {int}     isVIdeo       1 is for Video and 0 is for Image
 * @param  {int}     zipped        if video is zipped
 * @param  {String}  caption       Caption text in the snap
 * @return {Promise}
 */
e.postStory = function postStory(username, auth_token, mediaId, isVideo, zipped, caption) {
    var ts = Date.now().toString();
    var postData = {
        username: username,
        caption_text_display: caption,
        client_id: mediaId,
        media_id: mediaId,
        timestamp: ts,
        time: 3, // This time is recalculated by Snapchat so ...
        type: isVideo,
        zipped: zipped
    };

    return e.postCall('/bq/post_story', postData, auth_token, ts)
};

/**
 * Add a friend
 * @param  {String} username
 * @param  {String} auth_token
 * @param  {String} friend      Your soon to be friends
 * @return {Promise}
 */
e.addFriend = function addFriend(username, auth_token, friend) {
    var ts = Date.now().toString();
    return e.postCall('/bq/friend', {
            username: username,
            // display: username,
            timestamp: ts,
            action: 'add',
            friend: friend,
        }, auth_token, ts)
        .then(function(data) {
            return JSON.parse(data);
        });
};

/**
 * Change a friend's display name
 * @param  {String} username
 * @param  {String} auth_token
 * @param  {String} friend      The friend to modify
 * @param  {String} newName     Their new display name
 * @return {Promise}
 */
e.rename = function rename(username, auth_token, friend, newName) {
    var ts = Date.now().toString();
    return e.postCall('/ph/friend', {
            username: username,
            timestamp: ts,
            action: 'display',
            friend: friend,
            display: newName
        }, auth_token, ts)
        .then(function(data) {
            return JSON.parse(data);
        });
};

/**
 * Remove a friend
 * @param  {String} username
 * @param  {String} auth_token
 * @param  {String} friend      The friend to remove
 * @return {Promise}
 */
e.unfriend = function(username, auth_token, friend) {
    var ts = Date.now().toString();
    return e.postCall('/ph/friend', {
            username: username,
            timestamp: ts,
            action: 'delete',
            friend: friend,
        }, auth_token, ts)
        .then(function(data) {
            return JSON.parse(data);
        });
};

/**
 * Sign up
 * @param  {String}  email
 * @param  {String}  password
 * @param  {String}  username
 * @return {Promise} sync data
 */
e.register = function register(email, password, username) {
    var ts = Date.now().toString();
    return e.postCall('/ph/register', {
            timestamp: ts,
            password: password,
            email: email
        }, static_token, ts)
        .then(function(data) {
            var resp = JSON.parse(JSON.parse(data));
            var token = resp.token;
            if (typeof token === 'undefined')
                throw resp;

            var ts = Date.now().toString();
            return e.postCall('/ph/registeru', {
                    timestamp: ts,
                    email: email,
                    username: username,
                }, static_token, ts)
                .then(function(data) {
                    var resp = JSON.parse(data);
                    if (data.auth_token === 'undefined')
                        throw resp;
                    return resp;
                });
        });
};

/**
 * Clear your feed
 * @param  {String} username
 * @param  {String} auth_token
 * @return {Promise}
 */
e.clear = function clear(username, auth_token) {
    var ts = Date.now().toString();
    return e.postCall('/ph/clear', {
        timestamp: ts,
        username: username
    }, auth_token, ts);
};

/**
 * Update your email
 * @param  {String} username
 * @param  {String} auth_token
 * @param  {String} email       Your new email.
 * @return {Promise}
 */
e.updateEmail = function updateEmail(username, auth_token, email) {
    var ts = Date.now().toString();
    return e.postCall('/ph/settings', {
        timestamp: ts,
        action: 'updateEmail',
        email: email,
        username: username
    }, auth_token, ts);
};

/**
 * Update your privacy settings
 * @param  {String} username
 * @param  {String} auth_token
 * @param  {Boolean} only_friends
 * @return {Promise}
 */
e.privacy = function privacy(username, auth_token, only_friends) {
    only_friends = !!only_friends;
    var ts = Date.now().toString();
    return e.postCall('/ph/settings', {
        timestamp: ts,
        action: 'updatePrivacy',
        privacySetting: +only_friends,
        username: username
    }, auth_token, ts);
};

/**
 * Get updates from the SnapChat server
 * @param  {String} auth_token
 * @return {Promise}
 */
e.getUpdates = function(username, auth_token) {
    var ts = Date.now().toString();
    return e.postCall('/loq/all_updates', {
        timestamp: ts,
        username: username
    }, auth_token, ts);
};

e.getDeviceToken = function getDeviceToken() {
    var ts = Date.now().toString();
    return e.postCall('/loq/device_id', {

        timestamp: ts,
    }, static_token, ts);
    // body...
}

e.getGCMToken = function getGCMToken() {
    var ts = Date.now().toString(),
        post_data = {
            'X-GOOG.USER_AID': '3627197574756735564',
            'app': 'com.snapchat.android',
            'sender': '191410808405',
            'cert': '49f6badb81d89a9e38d65de76f09355071bd67e7',
            'device': '3627197574756735564',
            'app_ver': '510',
            'info': ''
        },
        data = qs.stringify(post_data);

    var opts = {
        uri: "https://android.clients.google.com/c2dm/register3",
        method: 'POST',
        // json: true,
        // path: endpoint,
        form: post_data,
        resolveWithFullResponse: false,
        headers: {
            // 'Accept-Language': 'en',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': data.length,
            'User-Agent': ' Android-GCM/1.4 (DIABLOX JDQ39)',
            // 'Accept-Locale': 'en_US',
            // 'accept-encoding': 'identity',
            'app': 'com.snapchat.android',
            'Authorization': 'AidLogin 36271975747567355643'
                // 'Accept': '*/*'
                // 'accept-encoding': 'identity'
        }
    };
    return rp(opts)
}

e.Client = require('./client');
