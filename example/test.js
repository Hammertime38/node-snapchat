#!/usr/bin/env node
var Q = require('q')
,  sc = require('../snapchat')
,  fs = require('fs')
,util = require('util');

var username = "mycalendar",
    password = "Password1";

    var c = new sc.Client();
    c.login(username, password)
        .then(function(data) {
            console.log(data)
          c.getStories().then(function(data) { 
            console.log(data)
          })
        })
