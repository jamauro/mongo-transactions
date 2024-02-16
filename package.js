Package.describe({
  name: 'jam:mongo-transactions',
  version: '1.0.2',
  summary: 'An easy way to use Mongo Transactions for Meteor apps',
  git: 'https://github.com/jamauro/mongo-transactions',
  documentation: 'README.md'
});

Package.onUse(function(api) {
  api.versionsFrom(['2.8.1', '3.0-alpha.19']);
  api.use('ecmascript');
  api.use('mongo');
  api.use('ddp-client');
  api.use('zodern:types@1.0.11');
  api.mainModule('mongo-transactions-client.js', 'client');
  api.mainModule('mongo-transactions-server.js', 'server');
});

Package.onTest(function(api) {
  api.use('ecmascript');
  api.use('tinytest');
  api.use('mongo');
  api.use('jam:mongo-transactions');
  api.mainModule('mongo-transactions-tests.js');
});
