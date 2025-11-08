// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title NoderDAO
 * @dev Governance contract for the Noderr trading bot network with trust-weighted voting
 * and specialized proposal types for strategy management.
 */
contract NoderDAO is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorTimelockControl,
    ReentrancyGuard,
    AccessControl
{
    // =============================================================
    // Constants & Types
    // =============================================================

    // Proposal types
    bytes32 public constant STRATEGY_PROPOSAL = keccak256("STRATEGY_PROPOSAL");
    bytes32 public constant PARAMETER_PROPOSAL = keccak256("PARAMETER_PROPOSAL");
    bytes32 public constant TREASURY_PROPOSAL = keccak256("TREASURY_PROPOSAL");
    bytes32 public constant NODE_MANAGEMENT_PROPOSAL = keccak256("NODE_MANAGEMENT_PROPOSAL");
    
    // Roles
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    
    // Trust scores
    uint256 public constant MIN_TRUST_SCORE = 0;
    uint256 public constant MAX_TRUST_SCORE = 100;
    uint256 public constant BASE_VOTING_WEIGHT = 50; // 50% of voting power is guaranteed
    
    // Structs
    
    /**
     * @dev Represents a trading strategy in the system
     */
    struct Strategy {
        bytes32 strategyHash;     // Hash of the strategy code
        address author;           // Address of the strategy creator
        uint256 proposalId;       // Governance proposal ID that activated it
        bool active;              // Whether the strategy is currently active
        uint256 activationTime;   // When the strategy was activated
        string metadataURI;       // URI pointing to strategy metadata (IPFS)
        mapping(address => bool) approvals; // Validator approvals
        uint256 approvalCount;    // Number of approvals received
    }
    
    /**
     * @dev Represents a node in the Noderr network
     */
    struct Node {
        address owner;            // Address that controls this node
        string nodeType;          // "ORACLE", "GUARDIAN", "VALIDATOR", "MICRO"
        bytes publicKey;          // Node's public key for message signing
        string endpoint;          // Network endpoint
        uint256 trustScore;       // Current trust score (0-100)
        uint256 lastUpdate;       // Last update timestamp
        bool active;              // Whether the node is active
    }

    // =============================================================
    // State Variables
    // =============================================================

    // Trust-weighted voting
    mapping(address => uint256) public trustScores;
    mapping(address => uint256) public lastTrustUpdate;
    
    // Merkle root for trust updates
    bytes32 public trustUpdateMerkleRoot;
    
    // Nodes registry
    mapping(string => Node) public nodes;
    string[] public nodeIds;
    mapping(address => string[]) public addressToNodes;
    
    // Strategy registry
    mapping(bytes32 => Strategy) public strategies;
    bytes32[] public activeStrategyIds;
    mapping(address => bytes32[]) public authorToStrategies;
    
    // Proposal tracking
    mapping(uint256 => bytes32) public proposalTypes;
    mapping(uint256 => bytes32) public proposalTargets; // For strategies, the strategy hash
    
    // =============================================================
    // Events
    // =============================================================
    
    event TrustScoreUpdated(address indexed account, uint256 previousScore, uint256 newScore);
    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    event StrategyActivated(bytes32 indexed strategyId, bytes32 strategyHash);
    event StrategyDeactivated(bytes32 indexed strategyId);
    event NodeRegistered(string indexed nodeId, address indexed owner, string nodeType);
    event NodeUpdated(string indexed nodeId, uint256 newTrustScore);
    event NodeDeactivated(string indexed nodeId);
    event TrustMerkleRootUpdated(bytes32 newRoot);

    // =============================================================
    // Constructor
    // =============================================================
    
    /**
     * @dev Initializes the governance contract with required parameters
     */
    constructor(
        ERC20Votes _token,
        TimelockController _timelock,
        uint256 _votingDelay,
        uint256 _votingPeriod,
        uint256 _proposalThreshold
    )
        Governor("NoderDAO")
        GovernorSettings(_votingDelay, _votingPeriod, _proposalThreshold)
        GovernorVotes(_token)
        GovernorTimelockControl(_timelock)
    {
        // Setup admin role
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // =============================================================
    // Trust Score Management
    // =============================================================
    
    /**
     * @dev Update trust score for an account
     * @param account Address to update
     * @param newScore New trust score (0-100)
     * @param merkleProof Proof that this update is authorized by validators
     */
    function updateTrustScore(
        address account,
        uint256 newScore,
        bytes32[] calldata merkleProof
    ) 
        external 
        nonReentrant 
    {
        require(newScore <= MAX_TRUST_SCORE, "Trust score must be 0-100");
        
        // Verify the merkle proof
        bytes32 leaf = keccak256(abi.encodePacked(account, newScore, block.timestamp));
        require(
            MerkleProof.verify(merkleProof, trustUpdateMerkleRoot, leaf), 
            "Invalid proof"
        );
        
        // Update trust score
        uint256 previousScore = trustScores[account];
        trustScores[account] = newScore;
        lastTrustUpdate[account] = block.timestamp;
        
        emit TrustScoreUpdated(account, previousScore, newScore);
    }
    
    /**
     * @dev Set the merkle root for trust updates - only callable by validators
     * @param newRoot New merkle root
     */
    function setTrustUpdateMerkleRoot(bytes32 newRoot) 
        external
        onlyRole(VALIDATOR_ROLE) 
    {
        trustUpdateMerkleRoot = newRoot;
        emit TrustMerkleRootUpdated(newRoot);
    }

    /**
     * @dev Apply trust weighting to votes
     * A voter's effective votes = actual votes * (BASE_VOTING_WEIGHT + (1 - BASE_VOTING_WEIGHT) * (trust score / MAX_TRUST_SCORE))
     * This gives a range from 50% to 100% of original voting power based on trust
     */
    function _getVotes(
        address account,
        uint256 blockNumber,
        bytes memory /*params*/
    ) 
        internal 
        view 
        override 
        returns (uint256) 
    {
        uint256 votes = super._getVotes(account, blockNumber, "");
        
        // Apply trust weighting if account has a trust score
        if (lastTrustUpdate[account] > 0) {
            uint256 trustModifier = BASE_VOTING_WEIGHT + 
                ((MAX_TRUST_SCORE - BASE_VOTING_WEIGHT) * trustScores[account]) / MAX_TRUST_SCORE;
            votes = (votes * trustModifier) / 100;
        }
        
        return votes;
    }

    // =============================================================
    // Strategy Management
    // =============================================================
    
    /**
     * @dev Register a new strategy (only callable by governance)
     * @param strategyHash Hash of the strategy code
     * @param author Address of the strategy's author
     * @param metadataURI URI pointing to strategy metadata (IPFS)
     */
    function registerStrategy(
        bytes32 strategyHash,
        address author,
        string calldata metadataURI
    )
        external
        onlyGovernance
    {
        require(strategies[strategyHash].author == address(0), "Strategy already exists");
        
        // Create new strategy (storage assignment)
        Strategy storage strategy = strategies[strategyHash];
        strategy.strategyHash = strategyHash;
        strategy.author = author;
        strategy.proposalId = 0; // Will be set on activation
        strategy.active = false;
        strategy.metadataURI = metadataURI;
        strategy.approvalCount = 0;
        
        // Add to author's strategies
        authorToStrategies[author].push(strategyHash);
    }
    
    /**
     * @dev Activate a registered strategy (only callable by governance)
     * @param strategyHash Hash of the strategy code
     * @param proposalId ID of the governance proposal
     */
    function activateStrategy(
        bytes32 strategyHash,
        uint256 proposalId
    )
        external
        onlyGovernance
    {
        Strategy storage strategy = strategies[strategyHash];
        require(strategy.author != address(0), "Strategy does not exist");
        require(!strategy.active, "Strategy already active");
        require(strategy.approvalCount >= 3, "Insufficient validator approvals");
        
        // Update strategy state
        strategy.active = true;
        strategy.activationTime = block.timestamp;
        strategy.proposalId = proposalId;
        
        // Add to active strategies
        activeStrategyIds.push(strategyHash);
        
        emit StrategyActivated(strategyHash, strategyHash);
    }
    
    /**
     * @dev Deactivate an active strategy (only callable by governance)
     * @param strategyHash Hash of the strategy to deactivate
     */
    function deactivateStrategy(bytes32 strategyHash)
        external
        onlyGovernance
    {
        Strategy storage strategy = strategies[strategyHash];
        require(strategy.author != address(0), "Strategy does not exist");
        require(strategy.active, "Strategy not active");
        
        // Update strategy state
        strategy.active = false;
        
        // Remove from active strategies (find and remove)
        for (uint256 i = 0; i < activeStrategyIds.length; i++) {
            if (activeStrategyIds[i] == strategyHash) {
                // Replace with the last element and pop
                activeStrategyIds[i] = activeStrategyIds[activeStrategyIds.length - 1];
                activeStrategyIds.pop();
                break;
            }
        }
        
        emit StrategyDeactivated(strategyHash);
    }
    
    /**
     * @dev Approve a strategy as a validator
     * @param strategyHash Hash of the strategy to approve
     */
    function approveStrategy(bytes32 strategyHash)
        external
        onlyRole(VALIDATOR_ROLE)
    {
        Strategy storage strategy = strategies[strategyHash];
        require(strategy.author != address(0), "Strategy does not exist");
        require(!strategy.approvals[msg.sender], "Already approved");
        
        strategy.approvals[msg.sender] = true;
        strategy.approvalCount++;
    }
    
    /**
     * @dev Get the number of active strategies
     */
    function getActiveStrategyCount() external view returns (uint256) {
        return activeStrategyIds.length;
    }
    
    /**
     * @dev Get a page of active strategy IDs
     * @param offset Starting index
     * @param limit Maximum number of items to return
     */
    function getActiveStrategies(uint256 offset, uint256 limit) 
        external 
        view 
        returns (bytes32[] memory) 
    {
        uint256 end = offset + limit;
        if (end > activeStrategyIds.length) {
            end = activeStrategyIds.length;
        }
        
        uint256 length = end - offset;
        bytes32[] memory result = new bytes32[](length);
        
        for (uint256 i = 0; i < length; i++) {
            result[i] = activeStrategyIds[offset + i];
        }
        
        return result;
    }

    // =============================================================
    // Node Management
    // =============================================================
    
    /**
     * @dev Register a new node in the network
     * @param nodeId Unique identifier for the node
     * @param nodeType Type of node ("ORACLE", "GUARDIAN", "VALIDATOR", "MICRO")
     * @param publicKey Node's public key for message signing
     * @param endpoint Network endpoint
     */
    function registerNode(
        string calldata nodeId,
        string calldata nodeType,
        bytes calldata publicKey,
        string calldata endpoint
    )
        external
        nonReentrant
    {
        require(nodes[nodeId].owner == address(0), "Node ID already exists");
        
        // Create new node
        Node storage node = nodes[nodeId];
        node.owner = msg.sender;
        node.nodeType = nodeType;
        node.publicKey = publicKey;
        node.endpoint = endpoint;
        node.trustScore = 10; // Default starting trust score
        node.lastUpdate = block.timestamp;
        node.active = true;
        
        // Add to registry
        nodeIds.push(nodeId);
        addressToNodes[msg.sender].push(nodeId);
        
        // Grant appropriate role based on node type
        if (keccak256(abi.encodePacked(nodeType)) == keccak256(abi.encodePacked("VALIDATOR"))) {
            grantRole(VALIDATOR_ROLE, msg.sender);
        } else if (keccak256(abi.encodePacked(nodeType)) == keccak256(abi.encodePacked("ORACLE"))) {
            grantRole(ORACLE_ROLE, msg.sender);
        } else if (keccak256(abi.encodePacked(nodeType)) == keccak256(abi.encodePacked("GUARDIAN"))) {
            grantRole(GUARDIAN_ROLE, msg.sender);
        }
        
        emit NodeRegistered(nodeId, msg.sender, nodeType);
    }
    
    /**
     * @dev Update a node's trust score (only callable by validators)
     * @param nodeId ID of the node to update
     * @param newTrustScore New trust score (0-100)
     */
    function updateNodeTrustScore(
        string calldata nodeId,
        uint256 newTrustScore
    )
        external
        onlyRole(VALIDATOR_ROLE)
    {
        require(newTrustScore <= MAX_TRUST_SCORE, "Trust score must be 0-100");
        require(nodes[nodeId].owner != address(0), "Node does not exist");
        
        Node storage node = nodes[nodeId];
        node.trustScore = newTrustScore;
        node.lastUpdate = block.timestamp;
        
        emit NodeUpdated(nodeId, newTrustScore);
    }
    
    /**
     * @dev Deactivate a node (only callable by node owner or governance)
     * @param nodeId ID of the node to deactivate
     */
    function deactivateNode(string calldata nodeId)
        external
    {
        Node storage node = nodes[nodeId];
        require(node.owner != address(0), "Node does not exist");
        require(
            node.owner == msg.sender || isGovernance(msg.sender),
            "Not authorized"
        );
        
        node.active = false;
        
        emit NodeDeactivated(nodeId);
    }
    
    /**
     * @dev Check if address is the governance timelock
     * @param account Address to check
     */
    function isGovernance(address account) internal view returns (bool) {
        return account == address(timelock());
    }
    
    /**
     * @dev Modifier that restricts function to the governance timelock
     */
    modifier onlyGovernance() {
        require(isGovernance(msg.sender), "Only governance can call");
        _;
    }

    // =============================================================
    // Required Governor Overrides
    // =============================================================
    
    function votingDelay() public view override(IGovernor, GovernorSettings) returns (uint256) {
        return super.votingDelay();
    }

    function votingPeriod() public view override(IGovernor, GovernorSettings) returns (uint256) {
        return super.votingPeriod();
    }

    function proposalThreshold() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.proposalThreshold();
    }

    function quorum(uint256 blockNumber) public view override(IGovernor) returns (uint256) {
        return (token().totalSupply() * 4) / 100; // 4% quorum
    }

    function state(uint256 proposalId) public view override(Governor, GovernorTimelockControl) returns (ProposalState) {
        return super.state(proposalId);
    }

    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public override(Governor, IGovernor) returns (uint256) {
        return super.propose(targets, values, calldatas, description);
    }
    
    /**
     * @dev Custom propose function that tracks proposal types
     */
    function proposeWithType(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description,
        bytes32 proposalType,
        bytes32 targetIdentifier
    ) public returns (uint256) {
        uint256 proposalId = propose(targets, values, calldatas, description);
        
        // Store proposal type and target
        proposalTypes[proposalId] = proposalType;
        proposalTargets[proposalId] = targetIdentifier;
        
        return proposalId;
    }

    function _execute(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._execute(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor() internal view override(Governor, GovernorTimelockControl) returns (address) {
        return super._executor();
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(Governor, GovernorTimelockControl, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
} 