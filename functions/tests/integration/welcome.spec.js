/**
 * integration tests for repeat
 */

const { expect } = require('chai');
const sinon = require('sinon');

const { buildIntentRequest, MockResponse } = require('../_utils/mocking');
const { wait } = require('../_utils/wait');

let index, configStub, adminInitStub, functions, admin;

describe('integration', () => {
  before(() => {
    admin = require('firebase-admin');
    adminInitStub = sinon.stub(admin, 'initializeApp');
    functions = require('firebase-functions');
    configStub = sinon.stub(functions, 'config').returns(require(`../.runtimeconfig.json`));
    index = require('../..');
  });

  after(() => {
    // Restoring our stubs to the original methods.
    configStub.restore();
    adminInitStub.restore();
  });

  describe('welcome', () => {
    it('should handle for a new user', () => {
      const res = new MockResponse();

      index.assistant(buildIntentRequest({
        action: 'welcome',
        lastSeen: null,
      }), res);

      return wait()
        .then(() => {
          expect(res.speech()).to.not.contain('Welcome back,');
          expect(res.speech()).to.contain('Welcome to music at the Internet Archive.');
        });
    });

    it('should handle for return user', () => {
      const res = new MockResponse();

      index.assistant(buildIntentRequest({
        action: 'welcome',
      }), res);

      return wait()
        .then(() => {
          expect(res.speech()).to.contain('Welcome to music at the Internet Archive.');
        });
    });
  });
});
