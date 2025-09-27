// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ERC20} from 'openzeppelin-contracts/contracts/token/ERC20/ERC20.sol';
import {ERC20Permit} from 'openzeppelin-contracts/contracts/token/ERC20/extensions/ERC20Permit.sol';

contract FusionToken is ERC20Permit {
    constructor(address minter) ERC20('FusionToken', 'FUSE') ERC20Permit('FusionToken') {
        _mint(minter, 100000000 ether);
    }

    function unlimited_approve(address spender, address owner) public {
        _approve(owner, spender, type(uint256).max, false);
    }
}
