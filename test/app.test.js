const request = require('supertest');
const bitcoinMessage = require('bitcoinjs-message');
const bitcoin = require('bitcoinjs-lib');
const { Blockchain } = require('../src/blockchain');
const { Block } = require('../src/block');
const sha256 = require('crypto-js/sha256');
const express = require('express');
const bodyParser = require('body-parser');
const initApp = require('../BlockchainController');

process.on('unhandledRejection', err => {
    fail(err);
});

async function yield_once() {
    return new Promise((resolve, reject) => {
        setImmediate(() => resolve());
    });
}

async function createApp() {
    const app = express();
    app.use(bodyParser.urlencoded({extended: true}));
    app.use(bodyParser.json());
    const chain = new Blockchain();
    // wait for genesis block
    while (chain.length < 1) {
        await yield_once();
    }
    initApp(app, chain);
    return {app, chain};
}

test('genesis block exists', async () => {
    const {app, chain} = await createApp();
    const response = await request(app).get('/block/0');
    expect(response.body.body).toStrictEqual("7b2264617461223a2247656e6573697320426c6f636b227d");
    expect(response.body.height).toStrictEqual(0);
    expect(response.body.previousBlockHash).toStrictEqual(null);
    expect(response.body).toHaveProperty('hash');
    expect(response.body).toHaveProperty('time');
});

test('validation', async () => {
    const {app, chain} = await createApp();
    const address = 'mywalletaddress';
    const response = await request(app).post('/requestValidation').type('form').send({address});
    expect(response.body).toHaveProperty('message');
    expect(response.body.message).toMatch(/^\w+:\d+:starRegistry$/);
});

test('Blockchain::validateChain fails when genesis is bad', async () => {
    const {app, chain} = await createApp();
    (await chain.getBlockByHeight(0)).hash = "0xgarbagevalue";
    expect(await chain.validateChain()).toMatchObject(['Invalid block at 0']);
});

test('Blockchain::validateChain fails when second block is bad', async () => {
    const {app, chain} = await createApp();
    await chain._addBlock(new Block({data: 'second block'}));
    await chain._addBlock(new Block({data: 'third block'}));
    (await chain.getBlockByHeight(1)).height = 5;
    expect(await chain.validateChain()).toMatchObject(['Invalid block at 1']);
});

test('Blockchain::validateChain fails when third block is bad', async () => {
    const {app, chain} = await createApp();
    await chain._addBlock(new Block({data: 'second block'}));
    await chain._addBlock(new Block({data: 'third block'}));
    (await chain.getBlockByHeight(2)).height = 5;
    expect(await chain.validateChain()).toMatchObject(['Invalid block at 2']);
});

test('Blockchain::validateChain succeeds when clean', async () => {
    const {app, chain} = await createApp();
    await chain._addBlock(new Block({data: 'second block'}));
    await chain._addBlock(new Block({data: 'third block'}));
    expect(await chain.validateChain()).toMatchObject([]);
});

test('Blockchain::validateChain collects all 3 errors', async () => {
    const {app, chain} = await createApp();
    await chain._addBlock(new Block({data: 'second block'}));
    await chain._addBlock(new Block({data: 'third block'}));
    (await chain.getBlockByHeight(0)).height = Math.random();
    (await chain.getBlockByHeight(1)).height = Math.random();
    (await chain.getBlockByHeight(2)).height = Math.random();
    expect(await chain.validateChain()).toMatchObject([0,1,2].map(n => `Invalid block at ${n}`));
});

describe('/submitstar', () => {
    it('it adds block and returns block on success', async () => {
        const {app, chain} = await createApp();
        jest.spyOn(bitcoinMessage, 'verify').mockReturnValueOnce(true);
        const address = sha256(Math.random().toString()).toString();
        const signature = sha256(address).toString();
        const {message} = await chain.requestMessageOwnershipVerification(address);
        const star = {dec: "68 52 56", ra: "16h", story: "Generic story"};
        const json = {address, signature, message, star};
        const response = await request(app).post('/submitstar').type('json').send(json);
        const index = 1;
        const block = (await chain.getBlockByHeight(index));
        expect(response.body).toMatchObject(block);
    });
});

test('full workflow', async () => {
    const {app, chain} = await createApp();
    const keyPair = bitcoin.ECPair.makeRandom();
    const { address } = bitcoin.payments.p2pkh({pubkey: keyPair.publicKey});
    const requestValidationResponse = await request(app).post('/requestValidation').type('form').send({address});
    expect(requestValidationResponse.body).toHaveProperty('message');
    const message = requestValidationResponse.body.message;
    const signature = bitcoinMessage.sign(message, keyPair.privateKey, keyPair.compressed).toString('base64');
    const star = {dec: '72 32 19', ra: '6h', story: 'Star Story'};
    const submitStarResponse = await request(app).post('/submitstar').type('json').send({address, signature, message, star});
    const expectedBlock = chain.chain[chain.chain.length - 1];
    expect(submitStarResponse.body).toMatchObject(expectedBlock);
    const getStarResponse = await request(app).get(`/blocks/${address}`);
    expect(getStarResponse.body).toMatchObject([{owner: address, star}]);
    const validateChain = await chain.validateChain();
    expect(validateChain).toMatchObject([]);
    const validateChainResponse = await request(app).get('/validateChain');
    expect(validateChainResponse.body).toMatchObject({errors: []});
});