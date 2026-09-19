// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * A Pons V2 look-alike for local rehearsals. Same public surface PETRI relies
 * on — LaunchParams layout, launchToken / launchAndBuy, the curve's
 * buy / sell / views, the fee escrow's balanceOf / claim — and the same
 * event signatures (TokenLaunched, CurveBuy, CurveSell), so the server's
 * indexer and keeper run unchanged against it. Numbers follow what was
 * measured on the real curve: 1e9 supply, 1.68 ETH phantom quote, 4.2 ETH
 * graduation threshold, 1% curve fee, creator tax taken on top. The one
 * thing Pons does off-chain — sweeping creator tax into the escrow — is a
 * public `sweep()` here, called by the local keeper.
 */

struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }
struct LaunchParams {
    string name; string symbol; string logo; string description; Socials socials;
    address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt;
}

contract MockEscrow {
    mapping(address => uint256) public balanceOf;
    event Credited(address indexed account, uint256 amount);
    event Claimed(address indexed account, uint256 amount);
    function credit(address account) external payable { balanceOf[account] += msg.value; emit Credited(account, msg.value); }
    function claim() external {
        uint256 amt = balanceOf[msg.sender]; require(amt > 0, "nothing to claim"); balanceOf[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amt}(""); require(ok, "send failed"); emit Claimed(msg.sender, amt);
    }
}

contract MockToken {
    string public name; string public symbol; uint8 public constant decimals = 18; uint256 public totalSupply;
    string public logo; string public description; address public deployer; address public curve;
    mapping(address => uint256) public balanceOf; mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    address private immutable factory;
    constructor(string memory n, string memory s, string memory l, string memory d, address dep, uint256 supply) {
        name = n; symbol = s; logo = l; description = d; deployer = dep; factory = msg.sender; totalSupply = supply; balanceOf[msg.sender] = supply; emit Transfer(address(0), msg.sender, supply);
    }
    function setCurve(address c) external { require(msg.sender == factory && curve == address(0), "curve set"); curve = c; }
    function approve(address sp, uint256 v) external returns (bool) { allowance[msg.sender][sp] = v; emit Approval(msg.sender, sp, v); return true; }
    function transfer(address to, uint256 v) external returns (bool) { _move(msg.sender, to, v); return true; }
    function transferFrom(address f, address to, uint256 v) external returns (bool) {
        uint256 a = allowance[f][msg.sender]; require(a >= v, "allowance"); if (a != type(uint256).max) allowance[f][msg.sender] = a - v; _move(f, to, v); return true;
    }
    function _move(address f, address to, uint256 v) internal { require(balanceOf[f] >= v, "balance"); balanceOf[f] -= v; balanceOf[to] += v; emit Transfer(f, to, v); }
}

contract MockCurve {
    uint256 public constant launchSupply = 1e9 ether;
    uint256 public constant phantomQuote = 1.68 ether;
    uint256 public constant graduationThreshold = 4.2 ether;
    uint256 public constant feeBps = 100;
    uint256 public immutable creatorTaxBps;
    address public immutable deployer;      // the creator fee recipient
    MockToken public immutable token;
    MockEscrow public immutable escrow;
    uint256 public realQuoteReserve; uint256 public tokenReserve; uint256 public quoteFeeBalance; uint256 public creatorTaxAccrued; bool public graduated;

    event CurveBuy(address indexed sender, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 creatorTax);
    event CurveSell(address indexed sender, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 creatorTax);
    event Graduated(uint256 quoteRaised);
    event Swept(uint256 creatorTax);

    constructor(MockToken t, address dep, uint16 taxBps, MockEscrow e) { token = t; deployer = dep; creatorTaxBps = taxBps; escrow = e; tokenReserve = launchSupply; }

    function getReserves() external view returns (uint256, uint256) { return (phantomQuote + realQuoteReserve, tokenReserve); }
    function isNativeQuote() external pure returns (bool) { return true; }
    function readyToGraduate() external view returns (bool) { return realQuoteReserve >= graduationThreshold; }

    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256 out) {
        require(!graduated, "graduated");
        require(msg.value == quoteIn, "NativeValueMismatch");
        uint256 fee = quoteIn * feeBps / 10000; uint256 tax = quoteIn * creatorTaxBps / 10000; uint256 net = quoteIn - fee - tax;
        out = tokenReserve * net / (phantomQuote + realQuoteReserve + net);
        require(out >= minTokensOut, "slippage");
        tokenReserve -= out; realQuoteReserve += net; quoteFeeBalance += fee; creatorTaxAccrued += tax;
        token.transfer(recipient, out);
        emit CurveBuy(msg.sender, recipient, quoteIn, out, fee, tax);
        if (realQuoteReserve >= graduationThreshold) { graduated = true; emit Graduated(realQuoteReserve); }
    }

    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) external returns (uint256 out) {
        require(!graduated, "graduated");
        token.transferFrom(msg.sender, address(this), tokensIn);
        uint256 gross = (phantomQuote + realQuoteReserve) * tokensIn / (tokenReserve + tokensIn);
        require(gross <= realQuoteReserve, "reserve");
        uint256 fee = gross * feeBps / 10000; uint256 tax = gross * creatorTaxBps / 10000; out = gross - fee - tax;
        require(out >= minQuoteOut, "slippage");
        tokenReserve += tokensIn; realQuoteReserve -= gross; quoteFeeBalance += fee; creatorTaxAccrued += tax;
        (bool ok, ) = recipient.call{value: out}(""); require(ok, "send failed");
        emit CurveSell(msg.sender, recipient, tokensIn, out, fee, tax);
    }

    /// Pons' sweeper, made public: move the accrued creator tax to the escrow for the fee recipient.
    function sweep() external { uint256 t = creatorTaxAccrued; if (t == 0) return; creatorTaxAccrued = 0; escrow.credit{value: t}(deployer); emit Swept(t); }
}

contract MockFactory {
    uint256 public constant launchFee = 0.0005 ether;
    bool public constant launchEnabled = true;
    uint256 public constant maxCreatorTaxBps = 1000;
    MockEscrow public immutable feeEscrow;
    address public launchForwarder;
    uint256 public launchCount;
    event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold);

    constructor(MockEscrow e) { feeEscrow = e; }
    function setForwarder(address f) external { launchForwarder = f; }
    function canLaunch(address) external pure returns (bool) { return true; }
    function approvedPairTokens(address pair) external pure returns (bool) { return pair == address(0); }
    function previewLaunchEconomics(uint256 configId, address pair) public pure returns (bytes32) { return keccak256(abi.encode(configId, pair)); }

    function launchToken(LaunchParams calldata p, uint256 configId, address pairToken, address[] calldata) public payable returns (address tokenAddr, address curveAddr) {
        require(msg.value >= launchFee, "launch fee");
        require(pairToken == address(0), "PairTokenNotApproved");
        require(p.expectedEconomics == previewLaunchEconomics(configId, pairToken), "LaunchEconomicsMismatch");
        require(p.creatorTaxBps <= maxCreatorTaxBps, "tax");
        MockToken t = new MockToken(p.name, p.symbol, p.logo, p.description, p.creatorFeeRecipient, 1e9 ether);
        MockCurve c = new MockCurve(t, p.creatorFeeRecipient, p.creatorTaxBps, feeEscrow);
        t.setCurve(address(c));
        t.transfer(address(c), 1e9 ether);
        launchCount++;
        emit TokenLaunched(address(t), address(c), msg.sender, pairToken, configId, c.graduationThreshold());
        return (address(t), address(c));
    }
}

contract MockForwarder {
    MockFactory public immutable factory;
    event Launched(address indexed token, address indexed curve, address indexed recipient, address launcher, uint256 quoteSpent, uint256 tokensReceived);
    constructor(MockFactory f) { factory = f; }
    function launchAndBuy(LaunchParams calldata p, uint256 configId, address pairToken, uint256 quoteIn, uint256 minTokensOut, address recipient, address[] calldata ex) external payable returns (address token, address curve, uint256 tokensOut) {
        require(quoteIn > 0, "ZeroAmount");
        require(msg.value == factory.launchFee() + quoteIn, "value");
        (token, curve) = factory.launchToken{value: factory.launchFee()}(p, configId, pairToken, ex);
        tokensOut = MockCurve(curve).buy{value: quoteIn}(quoteIn, minTokensOut, recipient);
        emit Launched(token, curve, recipient, msg.sender, quoteIn, tokensOut);
    }
}
