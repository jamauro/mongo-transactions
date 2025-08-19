# Tests before release for jam:mongo-transactions

Run the following commands:

First ensure .meteor/local/types is set up (`meteor lint` crashes)
```
npm i
meteor test --once --driver-package meteortesting:mocha --exclude-archs web.browser.legacy
```

Next ensure to Typescript errors
