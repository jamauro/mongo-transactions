Package.describe({
  name: 'jam:mongo-transactions',
  version: '1.2.1',
  summary: 'An easy way to use Mongo Transactions for Meteor apps',
  git: 'https://github.com/jamauro/mongo-transactions',
  documentation: 'README.md'
});

Package.onUse(function(api) {
  api.versionsFrom(['2.8.1', '3.0']);
  api.use('ecmascript');
  api.use('mongo');
  api.use('ddp-client');
  api.use('zodern:types@1.0.13');
  api.mainModule('client.js', 'client');
  api.mainModule('server.js', 'server');
});

Package.onTest(function(api) {
  api.use('ecmascript');
  api.use('tinytest');
  api.use('mongo');
  api.use('jam:mongo-transactions');
  api.mainModule('tests.js');
});
