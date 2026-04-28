// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract ShipPostPayment is Ownable, Pausable, ReentrancyGuard {
    address public agentWallet;
    address public treasury;
    address public reservePool;

    uint256 public threadCounter;

    mapping(address => bool) public allowedTokens;

    // Splits in basis points (must sum to 10000)
    uint256 public agentBp = 5000;    // 50%
    uint256 public treasuryBp = 4000; // 40%
    uint256 public reserveBp = 1000;  // 10%

    event ThreadRequested(
        address indexed user,
        uint256 indexed threadId,
        uint8 mode,
        address token,
        uint256 amount
    );
    event TokenAllowed(address indexed token, bool allowed);
    event FeeSplitUpdated(uint256 agentBp, uint256 treasuryBp, uint256 reserveBp);

    constructor(
        address _agentWallet,
        address _treasury,
        address _reservePool
    ) Ownable(msg.sender) {
        require(_agentWallet != address(0) && _treasury != address(0) && _reservePool != address(0), "ZERO_ADDR");
        agentWallet = _agentWallet;
        treasury = _treasury;
        reservePool = _reservePool;
    }

    function setAllowedToken(address token, bool allowed) external onlyOwner {
        allowedTokens[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function updateFeeSplit(uint256 _agentBp, uint256 _treasuryBp, uint256 _reserveBp) external onlyOwner {
        require(_agentBp + _treasuryBp + _reserveBp == 10000, "BP_SUM");
        agentBp = _agentBp;
        treasuryBp = _treasuryBp;
        reserveBp = _reserveBp;
        emit FeeSplitUpdated(_agentBp, _treasuryBp, _reserveBp);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Compute the required amount for a $0.05 thread in this token.
    function requiredAmount(address token) public view returns (uint256) {
        uint8 d = IERC20Metadata(token).decimals();
        require(d >= 2, "BAD_DECIMALS");
        // $0.05 = 5 * 10^(d-2)
        return 5 * (10 ** (d - 2));
    }

    function payForThread(address token, uint8 mode)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 threadId)
    {
        require(allowedTokens[token], "TOKEN_NOT_ALLOWED");
        uint256 amount = requiredAmount(token);

        IERC20(token).transferFrom(msg.sender, address(this), amount);

        uint256 agentShare = (amount * agentBp) / 10000;
        uint256 treasuryShare = (amount * treasuryBp) / 10000;
        uint256 reserveShare = amount - agentShare - treasuryShare;

        require(IERC20(token).transfer(agentWallet, agentShare), "TRANSFER_AGENT");
        require(IERC20(token).transfer(treasury, treasuryShare), "TRANSFER_TREASURY");
        require(IERC20(token).transfer(reservePool, reserveShare), "TRANSFER_RESERVE");

        threadCounter++;
        threadId = threadCounter;
        emit ThreadRequested(msg.sender, threadId, mode, token, amount);
    }
}
