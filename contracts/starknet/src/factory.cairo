use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
use core::hash::HashStateTrait;
use core::poseidon::PoseidonTrait;
use crate::token::{IFusionTokenDispatcher, IFusionTokenDispatcherTrait};
use core::starknet::storage::{
    Map, StoragePathEntry,
    StoragePointerReadAccess, StoragePointerWriteAccess,
};

#[derive(Drop, Serde, starknet::Store)]
pub struct Timelocks {
    pub withdrawal: u64,
    pub publicWithDrawalPeriod: u64,
    pub cancellation: u64,
    pub publicCancellationPeriod: u64,
    pub deployed_at: u64,
}

#[derive(Drop, Serde, starknet::Store)]
pub struct Escrow {
    pub safetyDeposit: u256,
    pub token_amount: u256,
    pub depositor: ContractAddress,
    pub taker: ContractAddress,
    pub hashlock: felt252,
    pub timelocks: Timelocks,
    pub creation_timestamp: u64,
    pub maker: ContractAddress,
    pub tokenContract: ContractAddress,
    pub safetyTokenContract: ContractAddress,
    pub is_active: bool,
}

#[starknet::interface]
pub trait IFactory<TContractState> {
    fn create_escrow_src(
        ref self: TContractState,
        depositor: ContractAddress,
        tokenContract: ContractAddress,
        safetyTokenContract: ContractAddress,
        token_amount: u256,
        safetyDeposit: u256,
        hashlock: felt252,
        withdrawal: u64,
        publicWithDrawalPeriod: u64,
        cancellation: u64,
        publicCancellationPeriod: u64,
        salt: felt252,
    ) -> felt252;

    fn create_escrow_dst(
        ref self: TContractState,
        tokenContract: ContractAddress,
        safetyTokenContract: ContractAddress,
        token_amount: u256,
        safetyDeposit: u256,
        taker: ContractAddress,
        hashlock: felt252,
        withdrawal: u64,
        publicWithDrawalPeriod: u64,
        cancellation: u64,
        publicCancellationPeriod: u64,
        salt: felt252,
    ) -> felt252;

    fn withdraw(
        ref self: TContractState,
        escrowId: felt252,
        secret: felt252,
    );

    fn cancel(
        ref self: TContractState,
        escrowId: felt252,
    );

    fn get_escrow_info(self: @TContractState, escrowId: felt252) -> Escrow;

    fn is_withdrawal_allowed(self: @TContractState, escrowId: felt252, caller: ContractAddress) -> bool;

    fn is_cancellation_allowed(self: @TContractState, escrowId: felt252, caller: ContractAddress) -> bool;
}

#[starknet::contract]
pub mod Factory {
    use super::{Timelocks, Escrow, ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use core::hash::HashStateTrait;
    use core::poseidon::PoseidonTrait;
    use crate::token::{IFusionTokenDispatcher, IFusionTokenDispatcherTrait};
    use core::starknet::storage::{
        Map, StoragePathEntry,
        StoragePointerReadAccess, StoragePointerWriteAccess,
    };

    const E_INVALID_SIGNER: felt252 = 'Invalid signer';
    const E_INVALID_TIMELOCK_STATE: felt252 = 'Invalid timelock';
    const E_INVALID_HASH_TYPE: felt252 = 'Invalid secret';
    const E_RESOURCE_DOESNT_EXIST: felt252 = 'Resource doesnt exist';
    const E_ESCROW_NOT_PUBLISHED: felt252 = 'Escrow not published';
    const E_INVALID_ASSET_TYPE: felt252 = 'Invalid asset type';

    #[storage]
    struct Storage {
        owner: ContractAddress,
        escrows: Map<felt252, Escrow>,
        nonce: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        EscrowCreated: EscrowCreated,
        EscrowWithdrawn: EscrowWithdrawn,
        EscrowCancelled: EscrowCancelled,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EscrowCreated {
        pub escrowId: felt252,
        pub maker: ContractAddress,
        pub taker: ContractAddress,
        pub token_amount: u256,
        pub safetyDeposit: u256,
        pub hashlock: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EscrowWithdrawn {
        pub escrowId: felt252,
        pub taker: ContractAddress,
        pub resolver: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EscrowCancelled {
        pub escrowId: felt252,
        pub maker: ContractAddress,
        pub canceller: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.owner.write(owner);
        self.nonce.write(0);
    }

    #[abi(embed_v0)]
    impl FactoryImpl of super::IFactory<ContractState> {
        fn create_escrow_src(
            ref self: ContractState,
            depositor: ContractAddress,
            tokenContract: ContractAddress,
            safetyTokenContract: ContractAddress,
            token_amount: u256,
            safetyDeposit: u256,
            hashlock: felt252,
            withdrawal: u64,
            publicWithDrawalPeriod: u64,
            cancellation: u64,
            publicCancellationPeriod: u64,
            salt: felt252,
        ) -> felt252 {
            let resolver = get_caller_address();
            
            let escrowId = self.generateEscrowId(
                depositor,
                resolver,
                hashlock,
                salt
            );

            let timelocks = Timelocks {
                withdrawal,
                publicWithDrawalPeriod,
                cancellation,
                publicCancellationPeriod,
                deployed_at: get_block_timestamp()
            };

            let escrow = Escrow {
                safetyDeposit,
                token_amount,
                depositor,
                taker: resolver,
                hashlock,
                timelocks,
                creation_timestamp: get_block_timestamp(),
                maker: resolver,
                tokenContract,
                safetyTokenContract,
                is_active: true,
            };

            let token = IFusionTokenDispatcher { contract_address: tokenContract };
            token.transfer_from(depositor, get_contract_address(), token_amount);
            
            let safety_token = IFusionTokenDispatcher { contract_address: safetyTokenContract };
            safety_token.transfer_from(resolver, get_contract_address(), safetyDeposit);

            self.escrows.entry(escrowId).write(escrow);

            self.emit(EscrowCreated {
                escrowId,
                maker: depositor,
                taker: resolver,
                token_amount,
                safetyDeposit,
                hashlock,
            });

            escrowId
        }

        fn create_escrow_dst(
            ref self: ContractState,
            tokenContract: ContractAddress,
            safetyTokenContract: ContractAddress,
            token_amount: u256,
            safetyDeposit: u256,
            taker: ContractAddress,
            hashlock: felt252,
            withdrawal: u64,
            publicWithDrawalPeriod: u64,
            cancellation: u64,
            publicCancellationPeriod: u64,
            salt: felt252,
        ) -> felt252 {
            let maker = get_caller_address();
            
            let escrowId = self.generateEscrowId(
                maker,
                taker,
                hashlock,
                salt
            );

            let timelocks = Timelocks {
                withdrawal,
                publicWithDrawalPeriod,
                cancellation,
                publicCancellationPeriod,
                deployed_at: get_block_timestamp()
            };

            let escrow = Escrow {
                safetyDeposit,
                token_amount,
                depositor: maker,
                taker,
                hashlock,
                timelocks,
                creation_timestamp: get_block_timestamp(),
                maker,
                tokenContract,
                safetyTokenContract,
                is_active: true,
            };

            let token = IFusionTokenDispatcher { contract_address: tokenContract };
            token.transfer_from(maker, get_contract_address(), token_amount);
            
            let safety_token = IFusionTokenDispatcher { contract_address: safetyTokenContract };
            safety_token.transfer_from(maker, get_contract_address(), safetyDeposit);

            self.escrows.entry(escrowId).write(escrow);

            self.emit(EscrowCreated {
                escrowId,
                maker,
                taker,
                token_amount,
                safetyDeposit,
                hashlock,
            });

            escrowId
        }

        fn withdraw(
            ref self: ContractState,
            escrowId: felt252,
            secret: felt252,
        ) {
            let mut escrow = self.escrows.entry(escrowId).read();
            assert(escrow.is_active, E_ESCROW_NOT_PUBLISHED);
            
            let resolver = get_caller_address();
            
            let hash_secret = PoseidonTrait::new().update(secret).finalize();
            assert(hash_secret == escrow.hashlock, E_INVALID_HASH_TYPE);
            
            let current_time = get_block_timestamp();
            let elapsed_time = current_time - escrow.creation_timestamp;
            
            if elapsed_time >= escrow.timelocks.publicWithDrawalPeriod {
                assert(elapsed_time < escrow.timelocks.cancellation, E_INVALID_TIMELOCK_STATE);
            } else {
                assert(elapsed_time >= escrow.timelocks.withdrawal, E_INVALID_TIMELOCK_STATE);
                assert(
                    resolver == escrow.taker || resolver == escrow.depositor,
                    E_INVALID_SIGNER
                );
            }

            let safety_token = IFusionTokenDispatcher { contract_address: escrow.safetyTokenContract };
            safety_token.transfer(resolver, escrow.safetyDeposit);

            let token = IFusionTokenDispatcher { contract_address: escrow.tokenContract };
            token.transfer(escrow.taker, escrow.token_amount);

            self.emit(EscrowWithdrawn {
                escrowId,
                taker: escrow.taker,
                resolver,
            });

            escrow.is_active = false;
            self.escrows.entry(escrowId).write(escrow);
        }

        fn cancel(
            ref self: ContractState,
            escrowId: felt252,
        ) {
            let mut escrow = self.escrows.entry(escrowId).read();
            assert(escrow.is_active, E_ESCROW_NOT_PUBLISHED);
            
            let canceller = get_caller_address();
            
            let current_time = get_block_timestamp();
            let elapsed_time = current_time - escrow.creation_timestamp;
            
            if elapsed_time < escrow.timelocks.publicCancellationPeriod {
                assert(elapsed_time >= escrow.timelocks.cancellation, E_INVALID_TIMELOCK_STATE);
                assert(canceller == escrow.depositor, E_INVALID_SIGNER);
            }

            let safety_token = IFusionTokenDispatcher { contract_address: escrow.safetyTokenContract };
            safety_token.transfer(canceller, escrow.safetyDeposit);

            let token = IFusionTokenDispatcher { contract_address: escrow.tokenContract };
            token.transfer(escrow.depositor, escrow.token_amount);

            self.emit(EscrowCancelled {
                escrowId,
                maker: escrow.depositor,
                canceller,
            });

            escrow.is_active = false;
            self.escrows.entry(escrowId).write(escrow);
        }

        fn get_escrow_info(self: @ContractState, escrowId: felt252) -> Escrow {
            let escrow = self.escrows.entry(escrowId).read();
            assert(escrow.is_active, E_RESOURCE_DOESNT_EXIST);
            escrow
        }

        fn is_withdrawal_allowed(self: @ContractState, escrowId: felt252, caller: ContractAddress) -> bool {
            let escrow = self.escrows.entry(escrowId).read();
            if !escrow.is_active {
                return false;
            }
            
            let current_time = get_block_timestamp();
            let elapsed_time = current_time - escrow.creation_timestamp;
            
            if elapsed_time >= escrow.timelocks.publicWithDrawalPeriod {
                elapsed_time < escrow.timelocks.cancellation
            } else if elapsed_time >= escrow.timelocks.withdrawal {
                caller == escrow.taker || caller == escrow.depositor
            } else {
                false
            }
        }

        fn is_cancellation_allowed(self: @ContractState, escrowId: felt252, caller: ContractAddress) -> bool {
            let escrow = self.escrows.entry(escrowId).read();
            if !escrow.is_active {
                return false;
            }
            
            let current_time = get_block_timestamp();
            let elapsed_time = current_time - escrow.creation_timestamp;
            
            if elapsed_time >= escrow.timelocks.publicCancellationPeriod {
                true
            } else if elapsed_time >= escrow.timelocks.cancellation {
                caller == escrow.depositor
            } else {
                false
            }
        }
    }

    #[generate_trait]
    pub(crate) impl InternalFactoryFunctions of InternalFactoryFunctionsTrait {
        fn generateEscrowId(
            ref self: ContractState,
            depositor: ContractAddress,
            taker: ContractAddress,
            hashlock: felt252,
            salt: felt252,
        ) -> felt252 {
            let current_nonce = self.nonce.read();
            self.nonce.write(current_nonce + 1);
            
            PoseidonTrait::new()
                .update(depositor.into())
                .update(taker.into())
                .update(hashlock)
                .update(salt)
                .update(current_nonce.low.into())
                .finalize()
        }
    }
}