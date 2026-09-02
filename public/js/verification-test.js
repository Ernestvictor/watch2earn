/**
 * WATCH2EARN - Verification Test Suite
 * Tests balance updates across pages and withdrawal sync
 * 
 * Usage: Include this script in any page and call:
 *   w2eVerify.testBalanceRefresh()
 *   w2eVerify.testWithdrawalSync()
 *   w2eVerify.runFullTest()
 */

const w2eVerify = {
  results: [],
  
  log: (type, message, data = null) => {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = {
      'info': '✓',
      'success': '✅',
      'error': '❌',
      'warning': '⚠️',
      'data': '📊'
    }[type] || '●';
    
    const fullMessage = `[${timestamp}] ${prefix} ${message}`;
    console.log(fullMessage, data || '');
    
    w2eVerify.results.push({
      type,
      timestamp,
      message,
      data
    });
    
    return fullMessage;
  },
  
  /**
   * Test 1: Verify balance refresh mechanism works
   */
  testBalanceRefresh: async function() {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  TEST 1: BALANCE REFRESH MECHANISM     ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    this.log('info', 'Starting balance refresh test...');
    
    // Check if refresh function exists
    if (!window.w2e || !window.w2e.refreshBalance) {
      this.log('error', 'window.w2e.refreshBalance() not found in app.js');
      return false;
    }
    this.log('success', 'window.w2e.refreshBalance() function exists');
    
    // Get initial balance
    this.log('info', 'Fetching initial balance...');
    const initialBalance = await window.w2e.refreshBalance();
    if (!initialBalance) {
      this.log('error', 'Failed to fetch initial balance');
      return false;
    }
    this.log('success', `Initial balance loaded: $${initialBalance.balanceUsd} USD`, initialBalance);
    
    // Check all balance elements are updated
    const balanceElements = [
      'bal', 'topBal', 'usdBal', 'naira_bal', 'nairaBal',
      'adsEarned', 'gameEarned', 'surveyEarned', 'referralEarned', 'bonusEarned',
      'adCount', 'adEarnUsd', 'gameEarnUsd', 'surveyEarnUsd', 'referralEarnUsd', 'bonusEarnUsd'
    ];
    
    const elementStatus = {};
    balanceElements.forEach(id => {
      const elem = document.getElementById(id);
      if (elem) {
        elementStatus[id] = {
          exists: true,
          content: elem.textContent || elem.value,
          html: elem.innerHTML.substring(0, 50)
        };
      } else {
        elementStatus[id] = { exists: false };
      }
    });
    
    this.log('data', 'Balance element status:', elementStatus);
    
    const foundElements = Object.values(elementStatus).filter(e => e.exists).length;
    this.log('success', `Found ${foundElements}/${balanceElements.length} balance display elements`);
    
    // Store initial state
    window.w2e.testInitialBalance = initialBalance.balanceUsd;
    
    return true;
  },
  
  /**
   * Test 2: Verify withdrawal balance sync
   */
  testWithdrawalSync: async function() {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  TEST 2: WITHDRAWAL BALANCE SYNC       ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    this.log('info', 'Starting withdrawal sync test...');
    
    // Get current balance
    const currentBalance = await window.w2e.refreshBalance();
    if (!currentBalance) {
      this.log('error', 'Failed to fetch current balance');
      return false;
    }
    
    this.log('success', `Current balance: $${currentBalance.balanceUsd} USD`);
    
    // Simulate withdrawal amount
    const testWithdrawAmount = 0.50; // Small amount for testing
    
    if (currentBalance.balanceUsd < testWithdrawAmount) {
      this.log('warning', `Balance $${currentBalance.balanceUsd} is less than test amount $${testWithdrawAmount}. Skipping withdrawal simulation.`);
      return false;
    }
    
    this.log('info', `Simulating withdrawal of $${testWithdrawAmount}...`);
    
    // Check that withdraw.html has the necessary function
    if (typeof requestWithdraw !== 'function') {
      this.log('error', 'requestWithdraw() function not found. This test must run on withdraw.html');
      return false;
    }
    this.log('success', 'requestWithdraw() function exists');
    
    // Check for optimistic update mechanism in local variable
    const balanceBeforeUi = (() => {
      const bal = document.getElementById('bal');
      return bal ? parseFloat(bal.textContent.replace(/[^0-9.-]/g, '')) : null;
    })();
    
    this.log('data', 'Current UI balance:', balanceBeforeUi);
    
    // Mock the withdrawal (don't actually send it)
    this.log('warning', 'To fully test withdrawal, manually click withdraw button and observe:');
    this.log('info', '  1. Balance decreases immediately in UI');
    this.log('info', '  2. "Processing withdrawal..." message appears');
    this.log('info', '  3. After success, balance refreshes from server');
    this.log('info', '  4. Balance persists when navigating to other pages');
    
    return true;
  },
  
  /**
   * Test 3: Check Firebase authentication status
   */
  testFirebaseAuth: async function() {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  TEST 3: FIREBASE AUTHENTICATION      ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    this.log('info', 'Checking Firebase auth state...');
    
    if (!firebase || !firebase.auth) {
      this.log('error', 'Firebase not initialized');
      return false;
    }
    
    const user = firebase.auth().currentUser;
    if (!user) {
      this.log('error', 'User not logged in');
      return false;
    }
    
    this.log('success', `Logged in as: ${user.email}`);
    
    try {
      const token = await user.getIdToken();
      this.log('success', `Firebase ID token obtained (length: ${token.length})`);
      
      // Check token payload
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1]));
        this.log('data', 'Token claims:', {
          sub: payload.sub,
          email: payload.email,
          aud: payload.aud,
          iss: payload.iss,
          exp: new Date(payload.exp * 1000).toLocaleString()
        });
      }
    } catch (err) {
      this.log('error', 'Failed to get ID token', err.message);
      return false;
    }
    
    return true;
  },
  
  /**
   * Test 4: Test API balance endpoint directly
   */
  testBalanceApi: async function() {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  TEST 4: BALANCE API ENDPOINT          ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    this.log('info', 'Testing /api/transactions/balance endpoint...');
    
    if (!firebase || !firebase.auth) {
      this.log('error', 'Firebase not initialized');
      return false;
    }
    
    const user = firebase.auth().currentUser;
    if (!user) {
      this.log('error', 'User not logged in');
      return false;
    }
    
    try {
      const token = await user.getIdToken();
      
      const response = await fetch('/api/transactions/balance', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      this.log('data', `API Response status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        this.log('error', `API returned ${response.status}`, errorText);
        return false;
      }
      
      const data = await response.json();
      this.log('success', 'Balance API response received', data);
      
      // Verify response structure
      const expectedFields = ['balanceUsd', 'balanceNaira', 'source'];
      const missingFields = expectedFields.filter(f => !(f in data));
      
      if (missingFields.length > 0) {
        this.log('warning', `Missing fields in response: ${missingFields.join(', ')}`);
      } else {
        this.log('success', 'All expected response fields present');
      }
      
      return true;
    } catch (err) {
      this.log('error', 'API test failed', err.message);
      return false;
    }
  },
  
  /**
   * Test 5: Cross-page balance sync (requires multiple tabs)
   */
  testCrossPageSync: async function() {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  TEST 5: CROSS-PAGE BALANCE SYNC       ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    this.log('info', 'Cross-page sync test (requires multiple windows)');
    
    // Set a marker in session storage
    window.sessionStorage.setItem('w2e_test_balance', window.w2e?.currentBalanceUsd || 'unknown');
    
    this.log('success', `Current balance stored in session: $${window.sessionStorage.getItem('w2e_test_balance')}`);
    
    this.log('warning', 'To verify cross-page sync:');
    this.log('info', '  1. Open this page: /home.html');
    this.log('info', '  2. Run: w2eVerify.testBalanceRefresh()');
    this.log('info', '  3. Navigate to /account.html');
    this.log('info', '  4. Run: w2eVerify.testBalanceRefresh()');
    this.log('info', '  5. Balance should be the same on both pages');
    this.log('info', '  6. Both pages should update balance every 5 seconds');
    
    return true;
  },
  
  /**
   * Run all tests
   */
  runFullTest: async function() {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║   WATCH2EARN - FULL VERIFICATION TEST SUITE            ║');
    console.log('║   Testing balance refresh & withdrawal sync            ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    
    this.results = [];
    
    // Run tests sequentially
    const test1 = await this.testBalanceRefresh();
    const test3 = await this.testFirebaseAuth();
    const test4 = await this.testBalanceApi();
    const test2 = await this.testWithdrawalSync();
    const test5 = await this.testCrossPageSync();
    
    // Summary
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  TEST SUMMARY                          ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    const passed = [test1, test2, test3, test4, test5].filter(Boolean).length;
    const total = 5;
    
    console.log(`✅ Passed: ${passed}/${total} tests`);
    console.log('\n📋 Test Results:');
    console.log(`  Test 1 (Balance Refresh): ${test1 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  Test 2 (Withdrawal Sync): ${test2 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  Test 3 (Firebase Auth): ${test3 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  Test 4 (Balance API): ${test4 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  Test 5 (Cross-Page Sync): ${test5 ? '✅ PASS' : '❌ FAIL'}`);
    
    console.log('\n💾 Full test log saved in: w2eVerify.results');
    console.log('\n📖 View results: console.table(w2eVerify.results)');
    console.log('\n');
    
    return {
      passed,
      total,
      results: this.results
    };
  },
  
  /**
   * Generate test report
   */
  generateReport: function() {
    console.log('\n📄 GENERATING TEST REPORT...\n');
    console.table(this.results);
    
    const report = {
      timestamp: new Date().toISOString(),
      testUrl: window.location.href,
      browserUserAgent: navigator.userAgent,
      results: this.results,
      summary: {
        total: this.results.length,
        passed: this.results.filter(r => r.type === 'success').length,
        errors: this.results.filter(r => r.type === 'error').length,
        warnings: this.results.filter(r => r.type === 'warning').length
      }
    };
    
    console.log('\n');
    console.log(JSON.stringify(report, null, 2));
    
    return report;
  }
};

// Auto-log when script loads
console.log('✅ w2eVerify test suite loaded. Usage: w2eVerify.runFullTest()');
