// Filename: app.js

var NEXMO_API_KEY = '';
var NEXMO_API_SECRET = '';
var NEXMO_NUMBER = '10000000000';
var PORT = 8080;
var HOST = 'http://0.0.0.0:'+PORT;
var SECRET_HASH = '82988f31-0513-4f8e-af39-ac2ac9ac4240';
var SESSION_TIMEOUT = 120*60*1000; // Number of milliseconds to keep tokens active (2 hours).

var MONGODB_ADDRESS = 'mongodb://127.0.0.1:27017/havewemet';

var express = require('express');
var bodyParser = require('body-parser');
var request = require('request');
var url = require('url');
var mongoose = require('mongoose');
var md5 = require('md5');

mongoose.connect(MONGODB_ADDRESS);

var app = express();
app.use(bodyParser.json());

var ContactModel = mongoose.model("Contacts", {
  user: String,
  name: String,
  phone: String,
  email: String,
  venue: String,
  type: String,
  time: Number,
  viewcount: Number
});

var ProfileModel = mongoose.model("Profiles", {
  number: String,
  name: String,
  template: String,
  resources: Array
});

// Handles text messages coming from Nexmo.
app.get('/api/nexmo', function(req, res) {
  var query = url.parse(req.url, true).query;
  var timeNow = new Date().getTime();
  var hash = md5(SECRET_HASH+query.msisdn+timeNow);

  var message = query.text.split(/[ \.] /);
  var messageHandled = false;

  ProfileModel.findOne({number: query.msisdn}, function(err, profile) {
    if(!profile || message[0].toLowerCase() == 'setup')
    {
      sendMessage(NEXMO_NUMBER, query.msisdn, 'Set up your card at: '+HOST+'/#/setup/'+query.msisdn+'/'+timeNow+'/'+hash);
      res.send('');
      return;
    }

    // One liner text messages are usually commands or searches.
    if(message.length == 1) {
      if(message[0].toLowerCase() == 'stats') {
        sendMessage(NEXMO_NUMBER, query.msisdn, 'View your contacts at: '+HOST+'/#/stats/'+query.msisdn+'/'+timeNow+'/'+hash);
        res.send('');
        return;
      }   

      ContactModel.findOne({$or: [{name: message[0]},{email: message[0]},{phone: message[0]}]}, function(err, contact) {
        if(err || !contact) {
          sendMessage(NEXMO_NUMBER, query.msisdn, 'I cannot find a contact matching "'+message[0]+'". Say hi for me!'); 
        } else {
          var text = 'You met '+contact.name+' at '+contact.venue;

          if(contact.phone && contact.phone.length > 0) {
            text += ' Phone: '+contact.phone;
          }

          if(contact.email && contact.email.length > 0) {
            text += ' Email: '+contact.email;
          }

          sendMessage(NEXMO_NUMBER, query.msisdn, text);
        }
        res.send('success');
      });

      return;
    }

    // If the new contact is preceded by the keyword text or sms, set the flag to send a SMS message to this contact.
    var sendSMS = false;
    if(message[0].toLowerCase() == 'text' || message[0].toLowerCase() == 'sms') {
      message.shift();
      sendSMS = true;
    }

    // Start building the contact.
    var contact = {
      name: message.shift(),
      venue: message.pop()
    };

    for(var i in message) {
      if(message[i].match(/[0-9]{7}/)) {
        contact.phone = message[i];

        continue;
      }

      var email = require('email-validation');
      if(email.valid(message[i])) {
        contact.email = message[i];
      }
    }
    
    // Use the Nexmo Insight API to get the formatted phone number and type of phone (mobile, landline, etc...)
    getInsight(contact.phone, function(err, response, body) {
      var json = JSON.parse(body);

      if(json.status == 0) {
        contact.user = query.msisdn;
        contact.phone = json.national_format_number;
        contact.type = json.current_carrier.network_type;
        contact.time = new Date().getTime();
        contact.viewcount = 0;

        ContactModel.create(contact, function(err, doc) {
          if(err) {
            console.log(err);
            return;
          }

          // Send a SMS message with the profile link if desired.
          if(sendSMS) {
            var message = profile.template;
            
            message = message.replace(/~~venue~~/, contact.venue);
            message = message.replace(/~~name~~/, contact.name);
            message = message.replace(/~~link~~/, HOST+'/#/card/'+doc._id);
          
            sendMessage(NEXMO_NUMBER, json.international_format_number, message);
          }
        });

        res.send('success');
      }
    });
  });
});

// Gets the profile info for the specified card.
app.get('/api/card/:id', function(req, res) {
  ContactModel.findOne({_id: req.params.id}, function(err, contact) {
    ContactModel.update({_id: req.params.id}, {$inc: {viewcount: 1}}, function(err, numAffected) {});

    ProfileModel.findOne({number: contact.user}, function(err, profile) {
      res.send({resources: profile.resources, name: profile.name});
    });
  });
});

// Gets all cards for the specified phone number.
app.get('/api/cards/:number/:timestamp/:token', function(req, res) {
  var timeNow = new Date().getTime();

  if(md5(SECRET_HASH+req.params.number+req.params.timestamp) != req.params.token || 
    parseInt(req.params.timestamp)+SESSION_TIMEOUT < timeNow) {
    res.send({error: 'Invalid or expired token'});
    return;
  }

  ContactModel.find({user: req.params.number}, function(err, results) {
    var contacts = [];
    
    for(var i in results) {
      contacts.push({
        name: results[i].name,
        email: results[i].email, 
        phone: results[i].phone, 
        venue: results[i].venue,
        views: results[i].viewcount,
        type: results[i].type,
        timecreated: results[i].time
      });
    }

    res.send(contacts);
  });
}); 

// Gets the profile to edit.
app.get('/api/profile/:number/:timestamp/:token', function(req, res) {
  var timeNow = new Date().getTime();

  if(md5(SECRET_HASH+req.params.number+req.params.timestamp) != req.params.token || 
    (parseInt(req.params.timestamp)+SESSION_TIMEOUT) < timeNow) {
    res.send({error: 'Invalid or expired token'});
    return;
  }

  ProfileModel.findOne({number: req.params.number}, function(err, profile) {
    if(err || !profile) {
      res.send({
        number: req.params.number, 
        resources: [],
        template: 'Pleasure meeting you at ~~venue~~!\n\n~~link~~'
      });
    } else {
      res.send(profile);
    }
  });
});

// Creates/modifies profile associated with phone number.
app.post('/api/profile/:number/:timestamp/:token', function(req, res) {
  var timeNow = new Date().getTime();

  if(md5(SECRET_HASH+req.params.number+req.params.timestamp) != req.params.token || 
    parseInt(req.params.timestamp)+SESSION_TIMEOUT < timeNow) {
    res.send({error: 'Invalid or expired token'});
    return;
  }

  var newProfile = {
    number: req.params.number,
    template: req.body.profile.template, 
    name: req.body.profile.name,
    resources: req.body.profile.resources
  };

  ProfileModel.findOne({number: req.params.number}, function(err, profile) {
    if(profile) {
      ProfileModel.update({_id: profile._id}, newProfile, function(err, numAffected) {
        res.send(profile);
      });
    } else {
      ProfileModel.create(newProfile, function(err, profile) {
        if(err || !profile) {
          res.send({error: 'Unable to create profile'});
          return;
        } else {
          res.send(profile);
        }
      });
    }
  });
});

// Sends SMS via Nexmo.
function sendMessage(from, to, message, callback) {
  request.get('https://rest.nexmo.com/sms/json?api_key='+NEXMO_API_KEY+'&api_secret='+NEXMO_API_SECRET+'&from='+from+'&to='+to+'&text='+encodeURIComponent(message), function(err, response) {
    if(callback)
      callback(err, response);
  });  
}

// Gets Number Insight from Nexmo.
function getInsight(number, callback) {
  request.get('https://api.nexmo.com/number/lookup/json?api_key='+NEXMO_API_KEY+'&api_secret='+NEXMO_API_SECRET+'&number='+number+'&country=US', function(err, response, body) {
    callback(err, response, body);
  });  
}

app.use(express.static(__dirname + '/public'));
console.log('Application listening on port '+PORT);
app.listen(PORT);