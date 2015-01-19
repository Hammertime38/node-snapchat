#!/usr/bin/env node
var Q = require('q')
,  sc = require('../snapchat')
,  fs = require('fs')
,util = require('util');

var username = "mib4fun",
    password = "azertyaqsd@";

    var c = new sc.Client();
    c.login(username, password)
        .then(function(data) {
            console.log(data)
          c.findFriends().then(function(data) { 
            console.log(data)
          })
        })
