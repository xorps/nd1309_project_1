/**
 *                          Blockchain Class
 *  The Blockchain class contain the basics functions to create your own private blockchain
 *  It uses libraries like `crypto-js` to create the hashes for each block and `bitcoinjs-message` 
 *  to verify a message signature. The chain is stored in the array
 *  `this.chain = [];`. Of course each time you run the application the chain will be empty because and array
 *  isn't a persisten storage method.
 *  
 */

const SHA256 = require('crypto-js/sha256');
const {Block} = require('./block.js');
const bitcoinMessage = require('bitcoinjs-message');

class Blockchain {
    /**
     * Constructor of the class, you will need to setup your chain array and the height
     * of your chain (the length of your chain array).
     * Also everytime you create a Blockchain class you will need to initialized the chain creating
     * the Genesis Block.
     * The methods in this class will always return a Promise to allow client applications or
     * other backends to call asynchronous functions.
     */
    constructor() {
        this.chain = [];
        this.initializeChain();
    }

    /**
     * This method will check for the height of the chain and if there isn't a Genesis Block it will create it.
     * You should use the `addBlock(block)` to create the Genesis Block
     * Passing as a data `{data: 'Genesis Block'}`
     */
    async initializeChain() {
        if (this.chain.length === 0) {
            await this._addBlock(new Block({data: 'Genesis Block'}));
        }
    }

    /**
     * Utility method that return a Promise that will resolve with the height of the chain
     */
    async getChainHeight() {
        return this.chain.length;
    }

    /**
     * _addBlock(block) will store a block in the chain
     * @param {*} block 
     * The method will return a Promise that will resolve with the block added
     * or reject if an error happen during the execution.
     * You will need to check for the height to assign the `previousBlockHash`,
     * assign the `timestamp` and the correct `height`...At the end you need to 
     * create the `block hash` and push the block into the chain array. Don't for get 
     * to update the `this.height`
     * Note: the symbol `_` in the method name indicates in the javascript convention 
     * that this method is a private method. 
     */
    async _addBlock(block) {
        block.height = this.chain.length;
        block.time = Date.now();
        block.previousBlockHash = block.height > 0 ? this.chain[block.height - 1].hash : null;
        block.hash = await block.computeHash();
        this.chain.push(block);
        // validate the chain
        const errors = await this.validateChain();
        if (errors.length > 0) throw new Error('chain validation failed');
    }

    /**
     * The requestMessageOwnershipVerification(address) method
     * will allow you  to request a message that you will use to
     * sign it with your Bitcoin Wallet (Electrum or Bitcoin Core)
     * This is the first step before submit your Block.
     * The method return a Promise that will resolve with the message to be signed
     * @param {*} address 
     */
    async requestMessageOwnershipVerification(address) {
        const timestamp = Date.now();
        const message = `${address}:${timestamp}:starRegistry`;
        return {message};
    }

    /**
     * The submitStar(address, message, signature, star) method
     * will allow users to register a new Block with the star object
     * into the chain. This method will resolve with the Block added or
     * reject with an error.
     * Algorithm steps:
     * 1. Get the time from the message sent as a parameter example: `parseInt(message.split(':')[1])`
     * 2. Get the current time: `let currentTime = parseInt(new Date().getTime().toString().slice(0, -3));`
     * 3. Check if the time elapsed is less than 5 minutes
     * 4. Veify the message with wallet address and signature: `bitcoinMessage.verify(message, address, signature)`
     * 5. Create the block and add it to the chain
     * 6. Resolve with the block added.
     * @param {*} address 
     * @param {*} message 
     * @param {*} signature 
     * @param {*} star 
     */
    async submitStar(address, message, signature, star) {
        // parse timestamp from message
        const timestamp = (() => {
            const result = /^(\w+):(\d+):starRegistry$/[Symbol.match](message);
            if (result === null) throw new Error('Mesage failed to parse');
            const [_, parsedAddress, timestampString] = result;
            if (parsedAddress !== address) throw new Error('Address does not match');
            const timestamp = Number(timestampString);
            if (isNaN(timestamp)) throw new Error('Message failed to convert timestamp to number');
            return timestamp;
        })();
        // make sure message is legit
        if (!bitcoinMessage.verify(message, address, signature)) throw new Error('Message verification failed');
        // make sure its not expired
        const ellapsed = Date.now() - timestamp;
        const FiveMinutes = 5 * 60_000;
        if (ellapsed >= FiveMinutes) throw new Error('Message expired');
        // create new block
        const block = new Block({owner: address, star});
        await this._addBlock(block);
        return block;
    }

    /**
     * This method will return a Promise that will resolve with the Block
     *  with the hash passed as a parameter.
     * Search on the chain array for the block that has the hash.
     * @param {*} hash 
     */
    async getBlockByHash(hash) {
        return this.chain.find(block => block.hash === hash);
    }

    /**
     * This method will return a Promise that will resolve with the Block object 
     * with the height equal to the parameter `height`
     * @param {*} height 
     */
    async getBlockByHeight(height) {
        return this.chain[height];
    }

    /**
     * This method will return a Promise that will resolve with an array of Stars objects existing in the chain 
     * and are belongs to the owner with the wallet address passed as parameter.
     * Remember the star should be returned decoded.
     * @param {*} address 
     */
    async getStarsByWalletAddress(address) {
        const [_ignore_gensis, ...rest] = this.chain;
        const blocks = await Promise.all(rest.map(block => block.getBData()));
        return blocks.filter(block => block.owner && block.owner === address);
    }

    /**
     * This method will return a Promise that will resolve with the list of errors when validating the chain.
     * Steps to validate:
     * 1. You should validate each block using `validateBlock`
     * 2. Each Block should check the with the previousBlockHash
     */
    async validateChain() {
        const [genesis, ...tail] = this.chain;
        const [errors, _] = await tail.reduce(async (acc, block, i) => {
            const [errors, previousBlock] = await acc;
            const isValid = (await previousBlock.validate()) && previousBlock.hash === block.previousBlockHash;
            const updateErrors = isValid ? errors : errors.concat(`Invalid block at ${i}`);
            return [updateErrors, block];
        }, Promise.resolve([[], genesis]));
        // last block can't really validate itself as nothing follows but we will just use its saved hash for now
        if (this.chain.length > 0 && !(await this.chain[this.chain.length - 1].validate())) {
            return errors.concat(`Invalid block at ${this.chain.length - 1}`);
        } else {
            return errors;
        }
    }
}

module.exports.Blockchain = Blockchain;