// ==========================================
// CONFIGURATION (INJECTED BY GITHUB ACTIONS)
// ==========================================
const PAYTM_CONFIG = {
    MID: "__PAYTM_MID__",
    WEBSITE: "__PAYTM_WEBSITE__",
    INDUSTRY_TYPE_ID: "__PAYTM_INDUSTRY__",
    CHANNEL_ID: "__PAYTM_CHANNEL__",
    MERCHANT_KEY: "__PAYTM_KEY__" 
};

const WEB_APP_URL = "__GOOGLE_WEB_APP_URL__";
const DEFAULT_ADMIN_USER = "__ADMIN_USERNAME__";
const DEFAULT_ADMIN_PASS = "__ADMIN_PASSWORD__";

// ==========================================
// GLOBAL VARIABLES & STATE
// ==========================================
let currentUser = null; 
let editingUsername = null; 
let cart = [];
let currentlyEditingProductId = null;
let paytmPollTimer = null;
let currentPaytmOrderId = null;
let expectedAmountGlobal = 0;
let isSyncing = false; 

// Initial Data
let usersDB = JSON.parse(localStorage.getItem('usersDB')) || [];
let products = JSON.parse(localStorage.getItem('products')) || [];
let sales = JSON.parse(localStorage.getItem('sales')) || [];
let auditLogs = JSON.parse(localStorage.getItem('auditLogs')) || [];
let attendanceDB = JSON.parse(localStorage.getItem('attendanceDB')) || [];
let shopProfile = JSON.parse(localStorage.getItem('shopProfile')) || {
    invPrefix: "INV-", invNextNum: 1, name: "SRI SAKTHI SYSTEMS", addr: "Shop No. 1, Main Road, City Center",
    gst: "33AAAAA0000A1Z5", state: "Tamil Nadu, Code : 33", contact: "+91 9876543210", email: "info@srisakthisystems.com", logoBase64: "",
    upiId: "", printBorder: "0", printMargin: "10", printFontSize: "11", pan: "", bankAcName: "", bankName: "", bankAccNo: "", bankIFSC: "", footerNote: ""
};

// ==========================================
// NETWORK & SYNC LOGIC
// ==========================================
function updateNetworkStatus(isOnline, customMsg = null) {
    let ns = document.getElementById('network-status');
    if(!ns) return;
    if (customMsg) {
        ns.innerHTML = customMsg;
        ns.style.background = '#f39c12';
    } else if(isOnline) { 
        ns.innerHTML = '🟢 ONLINE & SYNCED'; 
        ns.style.background = '#27ae60'; 
    } else { 
        ns.innerHTML = '🔴 OFFLINE'; 
        ns.style.background = '#c0392b'; 
    }
}

async function checkActualInternet() {
    if (!navigator.onLine) {
        updateNetworkStatus(false);
        return;
    }
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); 
        await fetch("https://www.gstatic.com/generate_204?_=" + new Date().getTime(), {
            method: 'HEAD', mode: 'no-cors', cache: 'no-store', signal: controller.signal
        });
        clearTimeout(timeoutId);
        updateNetworkStatus(true);
    } catch (error) {
        updateNetworkStatus(false); 
    }
}

window.addEventListener('online', checkActualInternet);
window.addEventListener('offline', () => updateNetworkStatus(false));
setInterval(checkActualInternet, 5000); 

async function syncData(key, dataObj) {
    localStorage.setItem(key, JSON.stringify(dataObj));
    if (WEB_APP_URL.includes('__GOOGLE_WEB_APP_URL__') || !navigator.onLine) return;
    
    // Prevent infinite loop for audit logs
    if (isSyncing && key === 'auditLogs') return;
    isSyncing = true;
    
    try {
        await fetch(WEB_APP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'syncData', key: key, data: dataObj })
        });
        updateNetworkStatus(true);
    } catch(e) {
        console.error("Sync Error:", e);
        updateNetworkStatus(false);
    } finally {
        isSyncing = false;
    }
}

async function fetchInitialCloudData() {
    if(!navigator.onLine || WEB_APP_URL.includes('__GOOGLE_WEB_APP_URL__')) return;
    updateNetworkStatus(true, '🔄 Syncing...');
    try {
        let res = await fetch(WEB_APP_URL + "?action=getAllData");
        let result = await res.json();
        
        if (result && result.data) {
            if (result.data.usersDB) { usersDB = result.data.usersDB; localStorage.setItem('usersDB', JSON.stringify(usersDB)); }
            if (result.data.products) { products = result.data.products; localStorage.setItem('products', JSON.stringify(products)); }
            if (result.data.sales) { sales = result.data.sales; localStorage.setItem('sales', JSON.stringify(sales)); }
            if (result.data.auditLogs) { auditLogs = result.data.auditLogs; localStorage.setItem('auditLogs', JSON.stringify(auditLogs)); }
            if (result.data.attendanceDB) { attendanceDB = result.data.attendanceDB; localStorage.setItem('attendanceDB', JSON.stringify(attendanceDB)); }
            if (result.data.shopProfile) { shopProfile = result.data.shopProfile; localStorage.setItem('shopProfile', JSON.stringify(shopProfile)); }
            
            if (currentUser) {
                renderUsersTable(); refreshInventoryUI(); refreshReportsUI(); refreshAuditUI(); refreshAttendanceUI(); loadProfileUI();
                document.getElementById('sidebar-shop-name').innerText = shopProfile.name || "BILLING SYSTEM";
            }
        }
        updateNetworkStatus(true);
    } catch (e) {
        console.error("Fetch Error:", e);
        updateNetworkStatus(false);
    }
}

// ==========================================
// CORE APP INITIALIZATION
// ==========================================
window.onload = () => { 
    checkActualInternet();
    setupAdminAccount();
    fetchInitialCloudData(); 
    let loginInput = document.getElementById('login-user');
    if(loginInput) loginInput.focus(); 
};

function setupAdminAccount() {
    // Failsafe: தற்செயலாக "__ADMIN_USERNAME__" என்பது யூசராக சேமிக்கப்பட்டிருந்தால், அதை அழிக்கவும்
    if (usersDB.some(u => u.username === '__ADMIN_USERNAME__')) {
        usersDB = [];
    }

    if (!Array.isArray(usersDB) || usersDB.length === 0 || !usersDB.some(u => u.role === 'ADMIN')) {
        usersDB = [{ 
            username: DEFAULT_ADMIN_USER, 
            password: DEFAULT_ADMIN_PASS, 
            role: 'ADMIN', 
            fullName: 'Super Admin', 
            dailyWage: 0, 
            permissions: { billing: true, reports: true, inventory: true, audit: true, profile: true, attendance: true } 
        }];
        if (!DEFAULT_ADMIN_USER.includes('__ADMIN_USERNAME__')) {
            syncData('usersDB', usersDB);
        } else {
            localStorage.setItem('usersDB', JSON.stringify(usersDB));
        }
    }
}

function attemptLogin() {
    let u = document.getElementById('login-user').value.trim();
    let p = document.getElementById('login-pass').value.trim();
    let foundUser = usersDB.find(user => user.username === u && user.password === p);
    
    if(foundUser) {
        currentUser = foundUser;
        document.getElementById('login-error').style.display = 'none';
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        
        document.getElementById('current-user-display').innerText = (currentUser.fullName || currentUser.username).toUpperCase() + (currentUser.role === 'ADMIN' ? ' 👑' : '');
        document.getElementById('sidebar-shop-name').innerText = shopProfile.name || "BILLING SYSTEM";
        
        logAudit('AUTH', 'User successfully logged in');
        applyUserPermissions();
        
        document.getElementById('dash-sale-date').valueAsDate = new Date();
        refreshInventoryUI(); refreshReportsUI(); refreshAuditUI(); refreshAttendanceUI(); loadProfileUI(); renderUsersTable();
        
        showSection('billing'); 
    } else {
        document.getElementById('login-error').style.display = 'block';
        logAudit('SECURITY', `Failed login attempt for username: ${u}`, u || 'Unknown');
    }
}

function logout() {
    logAudit('AUTH', 'User logged out');
    currentUser = null;
    document.getElementById('app-container').style.display = 'none';
    document.getElementById('login-container').style.display = 'flex';
    document.getElementById('login-user').value = '';
    document.getElementById('login-pass').value = '';
}

function showSection(id) {
    document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    const target = document.getElementById(id);
    if(target) target.classList.add('active');
    if(window.event && window.event.target && window.event.target.classList.contains('nav-btn')) {
        window.event.target.classList.add('active');
    }
}

function applyUserPermissions() {
    let p = currentUser.permissions || { billing: true, reports: true, attendance: true }; 
    document.getElementById('nav-billing').style.display = p.billing ? 'block' : 'none';
    document.getElementById('nav-reports').style.display = p.reports ? 'block' : 'none';
    document.getElementById('nav-inventory').style.display = p.inventory ? 'block' : 'none';
    document.getElementById('nav-audit').style.display = p.audit ? 'block' : 'none';
    document.getElementById('nav-attendance').style.display = p.attendance !== false ? 'block' : 'none';
    document.getElementById('nav-profile').style.display = p.profile ? 'block' : 'none';
    
    let isAdmin = currentUser.role === 'ADMIN';
    document.getElementById('btn-clear-sales').style.display = isAdmin ? 'block' : 'none';
    document.getElementById('admin-settings-panel').style.display = isAdmin ? 'block' : 'none';
    document.getElementById('admin-profile-details').style.display = isAdmin ? 'block' : 'none';
    let invForm = document.getElementById('inventory-admin-form');
    let invActTh = document.getElementById('inv-action-th');
    if(invForm) invForm.style.display = (p.inventory && isAdmin) ? 'grid' : 'none';
    if(invActTh) invActTh.style.display = (p.inventory && isAdmin) ? 'table-cell' : 'none';
}

function logAudit(type, desc, overrideUser = null) {
    let uName = overrideUser ? overrideUser : (currentUser ? currentUser.username : 'System');
    auditLogs.unshift({ timestamp: new Date().toISOString(), type, user: uName, desc });
    if(auditLogs.length > 500) auditLogs.length = 500;
    syncData('auditLogs', auditLogs);
    refreshAuditUI();
}

function refreshAuditUI() {
    const tbody = document.getElementById('audit-body');
    if(!tbody) return;
    tbody.innerHTML = '';
    auditLogs.forEach(log => {
        let color = log.type === 'SALE' ? 'var(--accent)' : log.type === 'SECURITY' ? '#e74c3c' : log.type === 'ATTENDANCE' ? '#f39c12' : 'var(--primary)';
        let d = new Date(log.timestamp).toLocaleString('en-GB');
        let usr = log.user || 'System';
        tbody.innerHTML += `<tr><td>${d}</td><td><strong style="color:${color};">${log.type}</strong></td><td>${usr}</td><td>${log.desc}</td></tr>`;
    });
}

function clearAuditHistory() {
    if(currentUser.role !== 'ADMIN') return alert("Access Denied.");
    if(confirm("Are you sure you want to clear Activity Log history?")) {
        auditLogs = []; syncData('auditLogs', auditLogs); refreshAuditUI();
    }
}

// ==========================================
// INVENTORY LOGIC
// ==========================================
function toggleInvStockField() {
    let isService = document.getElementById('inv-type').value === 'service';
    document.getElementById('inv-stock').disabled = isService;
    document.getElementById('inv-stock').value = isService ? '' : '0';
    document.getElementById('lbl-inv-stock').innerText = isService ? 'Stock (Not Applicable)' : 'Initial Stock';
}

function addProduct() {
    if(currentUser.role !== 'ADMIN') return alert("Access Denied.");
    let type = document.getElementById('inv-type').value;
    let name = document.getElementById('inv-name').value;
    let hsn = document.getElementById('inv-hsn').value || "-";
    let unit = document.getElementById('inv-unit').value || (type === 'service' ? 'Hr' : 'Nos');
    let rate = parseFloat(document.getElementById('inv-rate').value);
    let gst = parseFloat(document.getElementById('inv-gst').value);
    let stock = parseInt(document.getElementById('inv-stock').value) || 0;

    if(!name || isNaN(rate) || isNaN(gst)) return alert("Please fill Name, Rate, and GST.");

    if(currentlyEditingProductId) {
        let p = products.find(prod => prod.id === currentlyEditingProductId);
        p.type = type; p.name = name; p.hsn = hsn; p.unit = unit; p.rate = rate; p.gst = gst; p.stock = stock;
        logAudit('INVENTORY', `Updated ${type.toUpperCase()}: ${name}`);
        currentlyEditingProductId = null;
        document.getElementById('save-product-btn').innerText = "Save Item";
    } else {
        products.push({ id: Date.now(), type, name, hsn, unit, rate, gst, stock });
        logAudit('INVENTORY', `Added New ${type.toUpperCase()}: ${name}`);
    }
    syncData('products', products);
    document.querySelectorAll('#inventory .dash-input').forEach(inp => { if(inp.id !== 'inv-type') inp.value = '' });
    toggleInvStockField();
    refreshInventoryUI();
}

window.editProduct = function(id) {
    let p = products.find(prod => prod.id === id);
    if(p) {
        document.getElementById('inv-type').value = p.type || 'goods';
        document.getElementById('inv-name').value = p.name;
        document.getElementById('inv-hsn').value = p.hsn || "";
        document.getElementById('inv-unit').value = p.unit || "";
        document.getElementById('inv-rate').value = p.rate;
        document.getElementById('inv-gst').value = p.gst;
        document.getElementById('inv-stock').value = p.stock || 0;
        toggleInvStockField();
        currentlyEditingProductId = id;
        document.getElementById('save-product-btn').innerText = "Update Item";
        document.getElementById('inv-name').focus();
    }
};

window.adjustStock = function(id, type) {
    if(currentUser.role !== 'ADMIN') return alert("Access Denied.");
    let p = products.find(prod => prod.id === id);
    if(p.type === 'service') return alert("Services do not track stock!");
    let actionText = type === 'add' ? 'ADD to' : 'REDUCE from';
    let qty = parseInt(prompt(`Enter quantity to ${actionText} stock for: ${p.name}`, "1"));
    if(qty && qty > 0) {
        if (type === 'reduce' && qty > p.stock) return alert("Cannot reduce more than available stock!");
        p.stock += type === 'add' ? qty : -qty;
        logAudit('INVENTORY', `Manual Stock Adjust: ${type.toUpperCase()}ED ${qty} units for ${p.name}`);
        syncData('products', products); refreshInventoryUI();
    }
};

window.deleteProduct = function(id) {
    if(currentUser.role !== 'ADMIN') return alert("Access Denied.");
    let p = products.find(prod => prod.id === id);
    if(confirm(`Are you sure you want to delete '${p.name}'?`)) {
        products = products.filter(prod => prod.id !== id);
        syncData('products', products);
        logAudit('INVENTORY', `Deleted Item: ${p.name}`); refreshInventoryUI();
    }
};

function refreshInventoryUI() {
    const tbody = document.getElementById('inventory-body');
    if(!tbody) return;
    tbody.innerHTML = '';
    let totalQty = 0, totalValue = 0, isAdmin = currentUser && currentUser.role === 'ADMIN';

    products.forEach(p => {
        let stockDisplay = p.stock;
        let unitStr = p.unit || (p.type === 'service' ? 'Hr' : 'Nos');
        if(p.type === 'service') {
            stockDisplay = '<span style="color:#7f8c8d; font-size:12px;">N/A (Service)</span>';
        } else {
            totalQty += p.stock; totalValue += (p.stock * p.rate);
            stockDisplay = `<strong>${p.stock}</strong> <span style="font-size:11px; color:#666;">${unitStr}</span>`;
        }
        
        let actionsHTML = '';
        if(isAdmin) {
            if(p.type !== 'service') {
                actionsHTML += `<button class="btn btn-success" style="padding: 4px; font-size:11px;" onclick="window.adjustStock(${p.id}, 'add')">+ Add</button> 
                                <button class="btn btn-warning" style="padding: 4px; font-size:11px;" onclick="window.adjustStock(${p.id}, 'reduce')">- Red</button> `;
            }
            actionsHTML += `<button class="btn btn-info" style="padding: 4px; font-size:11px;" onclick="window.editProduct(${p.id})">Edit</button> 
                            <button class="btn btn-danger" style="padding: 4px; font-size:11px;" onclick="window.deleteProduct(${p.id})">Del</button>`;
        }
        let badgeColor = p.type === 'service' ? '#8e44ad' : '#2980b9';
        let typeBadge = `<span style="background:${badgeColor}; color:white; padding:2px 5px; border-radius:3px; font-size:10px;">${(p.type||'Goods').toUpperCase()}</span>`;

        tbody.innerHTML += `<tr><td>${typeBadge}</td><td>${p.name}</td><td>${p.hsn}</td><td>${unitStr}</td><td>₹${p.rate.toFixed(2)}</td><td>${p.gst}%</td><td>${stockDisplay}</td><td style="${!isAdmin ? 'display:none;' : ''}">${actionsHTML}</td></tr>`;
    });
    document.getElementById('inv-cum-items').innerText = products.length;
    document.getElementById('inv-cum-qty').innerText = totalQty;
    document.getElementById('inv-cum-value').innerText = totalValue.toFixed(2);
}

// ==========================================
// BILLING LOGIC
// ==========================================
function showAutocomplete(val) {
    const list = document.getElementById('autocomplete-list');
    list.innerHTML = ''; let filterVal = val.toLowerCase(), matchCount = 0;
    
    products.forEach(p => {
        if((p.type === 'service' || p.stock > 0) && (filterVal === '' || p.name.toLowerCase().includes(filterVal))) {
            let div = document.createElement('div');
            let unitStr = p.unit || (p.type === 'service' ? 'Hr' : 'Nos');
            let stockTxt = p.type === 'service' ? 'Service' : `Stock: ${p.stock} ${unitStr}`;
            div.innerHTML = `<strong>${p.name}</strong> <span style="font-size:12px; color:#666;">(${stockTxt}) | ₹${p.rate}</span>`;
            div.onclick = function() {
                document.getElementById('bill-product-name').value = p.name;
                document.getElementById('bill-product-id').value = p.id;
                document.getElementById('bill-item-type').value = p.type || 'goods';
                document.getElementById('bill-desc-edit').value = p.name;
                document.getElementById('bill-rate-edit').value = p.rate;
                list.style.display = 'none'; document.getElementById('bill-qty').focus(); 
            };
            list.appendChild(div); matchCount++;
        }
    });
    list.style.display = matchCount > 0 ? 'block' : 'none';
}

function addToCart() {
    let pIdVal = document.getElementById('bill-product-id').value;
    if(!pIdVal) return alert("Please select a product from the list.");
    let pId = parseInt(pIdVal); let product = products.find(p => p.id === pId);
    if(!product) return alert("Item not found.");

    let customDesc = document.getElementById('bill-desc-edit').value || product.name;
    let customRateStr = document.getElementById('bill-rate-edit').value;
    let customRate = customRateStr ? parseFloat(customRateStr) : product.rate;
    let qty = parseFloat(document.getElementById('bill-qty').value);
    if(isNaN(qty) || qty <= 0) return alert("Invalid Quantity");
    let disc = parseFloat(document.getElementById('bill-disc').value) || 0;
    let taxCalcMode = document.getElementById('bill-tax-calc').value;
    
    if(product.type !== 'service' && qty > product.stock) return alert(`Insufficient stock! Only ${product.stock} available.`);

    let effectiveBaseRate = customRate;
    if (taxCalcMode === 'inclusive') effectiveBaseRate = customRate / (1 + (product.gst / 100));
    let baseAmount = (effectiveBaseRate * qty) - disc;
    let finalAmount = baseAmount + (baseAmount * (product.gst / 100));

    cart.push({ ...product, customDesc, customRate: effectiveBaseRate, billQty: qty, unit: product.unit || (product.type === 'service' ? 'Hr' : 'Nos'), disc, baseAmount, finalAmount });
    
    if(product.type !== 'service') product.stock -= qty;
    
    document.getElementById('bill-product-name').value = ''; document.getElementById('bill-product-id').value = '';
    document.getElementById('bill-desc-edit').value = ''; document.getElementById('bill-rate-edit').value = '';
    document.getElementById('bill-qty').value = '1'; document.getElementById('bill-disc').value = '0';
    refreshCartUI();
}

window.removeCartItem = function(index) {
    let item = cart[index];
    let product = products.find(p => p.id === item.id);
    if(product && product.type !== 'service') product.stock += item.billQty;
    cart.splice(index, 1);
    refreshCartUI();
};

function refreshCartUI() {
    const tbody = document.getElementById('cart-body');
    tbody.innerHTML = ''; let total = 0;
    cart.forEach((c, idx) => {
        total += c.finalAmount; let r = c.customRate || c.rate || 0;
        let displayUnit = c.unit || (c.type === 'service' ? 'Hr' : 'Nos');
        tbody.innerHTML += `<tr><td>${c.customDesc || c.name}</td><td>₹${r.toFixed(2)}</td><td>${c.billQty} <span style="font-size:11px; color:#666;">${displayUnit}</span></td><td>₹${(c.disc || 0).toFixed(2)}</td><td>${c.gst}%</td><td>₹${c.finalAmount.toFixed(2)}</td><td><button class="btn btn-danger" onclick="window.removeCartItem(${idx})">X</button></td></tr>`;
    });
    document.getElementById('cart-total').innerText = total.toFixed(2);
}

function applyPageSizeSettings() {
    let selectedSize = document.getElementById('print-page-size').value;
    const sizeConfig = { 'A4': { width: '190mm', height: '277mm' }, 'A5': { width: '128mm', height: '190mm' }, 'Letter': { width: '195.9mm', height: '259.4mm' }, 'Legal': { width: '195.9mm', height: '335.6mm' } };
    let config = sizeConfig[selectedSize];
    let margin = shopProfile.printMargin || "10", border = shopProfile.printBorder || "0", fontSize = shopProfile.printFontSize || "11";
    let styleEl = document.getElementById('dynamic-page-style');
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'dynamic-page-style'; document.head.appendChild(styleEl); }
    styleEl.innerHTML = `@media print { @page { size: ${selectedSize}; margin: ${margin}mm; } body { font-size: ${fontSize}px !important; } .tally-invoice-wrapper { width: ${config.width} !important; min-height: ${config.height} !important; border: ${border}px solid #000; padding: ${border > 0 ? '5px' : '0'}; } }`;
}

function renderInvoiceToDOM(saleObj) {
    applyPageSizeSettings();
    document.getElementById('print-timestamp').innerText = new Date().toLocaleString('en-GB');
    document.getElementById('print-shop-name').innerText = shopProfile.name;
    document.getElementById('print-sign-name').innerText = shopProfile.name;
    document.getElementById('print-shop-addr').innerText = shopProfile.addr;
    document.getElementById('print-shop-gst').innerText = shopProfile.gst;
    document.querySelectorAll('#print-shop-state').forEach(el => el.innerText = shopProfile.state);
    document.getElementById('print-shop-state-2').innerText = shopProfile.state;
    document.getElementById('print-shop-contact').innerText = shopProfile.contact;
    document.getElementById('print-shop-email').innerText = shopProfile.email;
    document.getElementById('out-billed-by').innerText = saleObj.billedBy || 'Unknown';
    if(shopProfile.logoBase64) { document.getElementById('print-logo-img').src = shopProfile.logoBase64; document.getElementById('print-logo-img').style.display = 'block'; } else { document.getElementById('print-logo-img').style.display = 'none'; }
    document.getElementById('out-cust-name').innerText = saleObj.customer;
    document.getElementById('out-cust-addr').innerText = saleObj.custAddr || "\u00A0";
    if(saleObj.custGst) { document.getElementById('out-cust-gst-row').style.display = 'block'; document.getElementById('out-cust-gst').innerText = saleObj.custGst; } else { document.getElementById('out-cust-gst-row').style.display = 'none'; }
    document.getElementById('out-inv-no').innerText = saleObj.invNo;
    document.getElementById('out-inv-date').innerText = saleObj.date;

    let extra = saleObj.extra || {};
    document.getElementById('out-del-note').innerText = extra.delNote || "\u00A0";
    document.getElementById('out-pay-mode').innerText = saleObj.payMode || "Cash"; 
    document.getElementById('out-sup-ref').innerText = extra.supRef || "\u00A0";
    document.getElementById('out-other-ref').innerText = extra.otherRef || "\u00A0";
    document.getElementById('out-order-no').innerText = extra.orderNo || "\u00A0";
    let odDate = extra.orderDate ? new Date(extra.orderDate).toLocaleDateString('en-GB') : "\u00A0";
    document.getElementById('out-order-date').innerText = odDate;
    document.getElementById('out-terms-del').innerText = extra.termsDel || "\u00A0";
    document.getElementById('out-dispatch-doc').innerText = extra.dispatchDocNo || "\u00A0";
    let dnDate = extra.delNoteDate ? new Date(extra.delNoteDate).toLocaleDateString('en-GB') : "\u00A0";
    document.getElementById('out-del-note-date').innerText = dnDate;
    document.getElementById('out-dispatched-through').innerText = extra.dispatchedThrough || "\u00A0";
    document.getElementById('out-destination').innerText = extra.destination || "\u00A0";

    if(shopProfile.pan) { document.getElementById('out-pan-row').style.display = 'block'; document.getElementById('out-pan').innerText = shopProfile.pan; } else { document.getElementById('out-pan-row').style.display = 'none'; }

    let hasBankDetails = shopProfile.bankAcName || shopProfile.bankName || shopProfile.bankAccNo || shopProfile.bankIFSC;
    if(hasBankDetails) {
        document.getElementById('out-bank-row').style.display = 'block';
        document.getElementById('out-bank-acname').innerText = shopProfile.bankAcName || "-";
        document.getElementById('out-bank-name').innerText = shopProfile.bankName || "-";
        document.getElementById('out-bank-accno').innerText = shopProfile.bankAccNo || "-";
        document.getElementById('out-bank-ifsc').innerText = shopProfile.bankIFSC || "-";
    } else { document.getElementById('out-bank-row').style.display = 'none'; }
    document.getElementById('out-footer-note').innerText = shopProfile.footerNote || "";

    const tbody = document.getElementById('invoice-items');
    tbody.innerHTML = '';
    
    saleObj.items.forEach((c, index) => {
        let r = c.customRate || c.rate || 0;
        let amount = (c.billQty * r) - (c.disc || 0);
        if(amount < 0) amount = 0;
        let printUnit = c.unit || (c.type === 'service' ? 'Hr' : 'Nos');
        tbody.innerHTML += `<tr><td class="text-center">${index + 1}</td><td class="bold"><div style="white-space: pre-wrap; margin: 0; line-height: 1.1;">${c.customDesc || c.name || ''}</div></td><td class="text-center">${c.hsn}</td><td class="text-center bold">${c.billQty} <span style="font-size:8px; color:#666;">${printUnit}</span></td><td class="text-right">${r.toFixed(2)}</td><td class="text-center">${printUnit}</td><td class="text-right bold">${amount.toFixed(2)}</td></tr>`;
    });

    calculateInvoiceMathAndTotals(saleObj);
}

function processNewSaleAndPrint() {
    if(cart.length === 0) return alert("Cart is empty!");

    let dateObj = document.getElementById('dash-sale-date').value ? new Date(document.getElementById('dash-sale-date').value) : new Date();
    let invoiceNo = shopProfile.invPrefix + shopProfile.invNextNum.toString().padStart(3, '0');
    let selectedTaxMode = document.getElementById('dash-tax-mode').value;
    
    let newSale = {
        invNo: invoiceNo, date: dateObj.toLocaleDateString('en-GB'), timestamp: dateObj.toISOString(),
        customer: document.getElementById('dash-cust-name').value || 'Cash Customer',
        custAddr: document.getElementById('dash-cust-addr').value || '', custGst: document.getElementById('dash-cust-gst').value || '',
        taxMode: selectedTaxMode, payMode: document.getElementById('dash-pay-mode').value, billedBy: currentUser.fullName || currentUser.username,
        extra: {
            delNote: document.getElementById('dash-del-note').value, supRef: document.getElementById('dash-sup-ref').value,
            otherRef: document.getElementById('dash-other-ref').value, orderNo: document.getElementById('dash-order-no').value,
            orderDate: document.getElementById('dash-order-date').value, termsDel: document.getElementById('dash-terms-del').value,
            dispatchDocNo: document.getElementById('dash-dispatch-doc').value, delNoteDate: document.getElementById('dash-del-note-date').value,
            dispatchedThrough: document.getElementById('dash-dispatched-through').value, destination: document.getElementById('dash-destination').value,
        },
        items: [...cart], status: 'Completed', total: 0
    };

    renderInvoiceToDOM(newSale);
    newSale.total = parseFloat(document.getElementById('grand-total').innerText);
    sales.push(newSale);
    
    shopProfile.invNextNum += 1;
    saveProfile(true); 
    syncData('products', products); 
    syncData('sales', sales); 
    
    logAudit('SALE', `Generated Invoice ${invoiceNo} [${selectedTaxMode}] for ${newSale.customer} (₹${newSale.total})`);
    refreshReportsUI();
    
    cart = []; refreshCartUI();
    document.getElementById('dash-cust-name').value = 'Cash Customer'; document.getElementById('dash-cust-addr').value = '';
    document.getElementById('dash-cust-gst').value = ''; document.getElementById('dash-pay-mode').value = 'Cash';
    document.getElementById('upi-action-container').style.display = 'none'; document.getElementById('bill-product-name').value = '';
    document.getElementById('dash-sale-date').valueAsDate = new Date();
    window.print();
}

window.reprintInvoice = function(index) {
    let historicSale = sales[index];
    renderInvoiceToDOM(historicSale);
    logAudit('SALE', `Reprinted Invoice ${historicSale.invNo}`);
    window.print();
};

function calculateInvoiceMathAndTotals(saleObj) {
    let taxMode = saleObj.taxMode || 'LOCAL';
    let totalQty = 0, totalTaxableValue = 0, totalCGST = 0, totalSGST = 0, totalIGST = 0, taxBreakdown = {};

    saleObj.items.forEach(c => {
        let r = c.customRate || c.rate || 0, qty = c.billQty || 0, disc = c.disc || 0;
        let baseAmount = (r * qty) - disc; if(baseAmount < 0) baseAmount = 0;
        totalQty += qty; totalTaxableValue += baseAmount;
        let gstRate = c.gst || 0, totalItemTax = baseAmount * (gstRate / 100);
        if (!taxBreakdown[gstRate]) taxBreakdown[gstRate] = { taxable: 0, cgst: 0, sgst: 0, igst: 0, hsn: c.hsn };
        taxBreakdown[gstRate].taxable += baseAmount;

        if (taxMode === 'LOCAL') {
            let halfTax = totalItemTax / 2; totalCGST += halfTax; totalSGST += halfTax;
            taxBreakdown[gstRate].cgst += halfTax; taxBreakdown[gstRate].sgst += halfTax;
        } else {
            totalIGST += totalItemTax; taxBreakdown[gstRate].igst += totalItemTax;
        }
    });

    document.getElementById('total-qty').innerText = totalQty;
    let rawGrandTotal = totalTaxableValue + totalCGST + totalSGST + totalIGST;
    let grandTotal = Math.round(rawGrandTotal); let roundOff = grandTotal - rawGrandTotal;

    let roundOffCell = document.getElementById('round-off-amount');
    if (Math.abs(roundOff) < 0.005) { if(roundOffCell.closest('tr')) roundOffCell.closest('tr').style.display = 'none'; } 
    else { if(roundOffCell.closest('tr')) roundOffCell.closest('tr').style.display = ''; roundOffCell.innerText = (roundOff < 0 ? '(-)' : '(+)') + Math.abs(roundOff).toFixed(2); }

    document.getElementById('grand-total').innerText = grandTotal.toFixed(2);
    document.getElementById('amount-words').innerText = convertNumberToWords(Math.round(grandTotal));

    let tbody = document.getElementById('tax-breakdown-body'); tbody.innerHTML = '';
    let sumTaxable = 0, sumTotalTax = 0;

    if (taxMode === 'LOCAL') {
        document.getElementById('tally-tax-header-row-1').innerHTML = `<th rowspan="2" style="width:18%;">HSN/SAC</th><th rowspan="2" style="width:16%;">Taxable Value</th><th colspan="2" style="width:24%;">Central Tax</th><th colspan="2" style="width:24%;">State Tax</th><th rowspan="2" style="width:18%;">Total Tax Amount</th>`;
        document.getElementById('tally-tax-header-row-2').innerHTML = `<th style="width:10%;">Rate</th><th style="width:14%;">Amount</th><th style="width:10%;">Rate</th><th style="width:14%;">Amount</th>`;
        let sumCGST = 0, sumSGST = 0;
        Object.keys(taxBreakdown).forEach(rate => {
            let b = taxBreakdown[rate], halfRate = parseFloat(rate) / 2, itemTaxTotal = b.cgst + b.sgst;
            sumTaxable += b.taxable; sumCGST += b.cgst; sumSGST += b.sgst; sumTotalTax += itemTaxTotal;
            tbody.innerHTML += `<tr><td class="text-center">${b.hsn || '9984'}</td><td class="text-right">${b.taxable.toFixed(2)}</td><td class="text-center">${halfRate}%</td><td class="text-right">${b.cgst.toFixed(2)}</td><td class="text-center">${halfRate}%</td><td class="text-right">${b.sgst.toFixed(2)}</td><td class="text-right bold">${itemTaxTotal.toFixed(2)}</td></tr>`;
        });
        document.getElementById('tally-tax-footer-row').innerHTML = `<td class="text-right bold">Total</td><td class="text-right bold">${sumTaxable.toFixed(2)}</td><td></td><td class="text-right bold">${sumCGST.toFixed(2)}</td><td></td><td class="text-right bold">${sumSGST.toFixed(2)}</td><td class="text-right bold">₹ ${sumTotalTax.toFixed(2)}</td>`;
    } else {
        document.getElementById('tally-tax-header-row-1').innerHTML = `<th rowspan="2" style="width:25%;">HSN/SAC</th><th rowspan="2" style="width:20%;">Taxable Value</th><th colspan="2" style="width:30%;">Integrated Tax</th><th rowspan="2" style="width:25%;">Total Tax Amount</th>`;
        document.getElementById('tally-tax-header-row-2').innerHTML = `<th style="width:12%;">Rate</th><th style="width:18%;">Amount</th>`;
        let sumIGST = 0;
        Object.keys(taxBreakdown).forEach(rate => {
            let b = taxBreakdown[rate]; sumTaxable += b.taxable; sumIGST += b.igst; sumTotalTax += b.igst;
            tbody.innerHTML += `<tr><td class="text-center">${b.hsn || '9984'}</td><td class="text-right">${b.taxable.toFixed(2)}</td><td class="text-center">${parseFloat(rate)}%</td><td class="text-right">${b.igst.toFixed(2)}</td><td class="text-right bold">${b.igst.toFixed(2)}</td></tr>`;
        });
        document.getElementById('tally-tax-footer-row').innerHTML = `<td class="text-right bold">Total</td><td class="text-right bold">${sumTaxable.toFixed(2)}</td><td></td><td class="text-right bold">${sumIGST.toFixed(2)}</td><td class="text-right bold">₹ ${sumTotalTax.toFixed(2)}</td>`;
    }
    document.getElementById('tax-words').innerText = convertNumberToWords(Math.round(sumTotalTax));
}

function convertNumberToWords(amount) {
    let words = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen','Twenty'];
    words[30]='Thirty'; words[40]='Forty'; words[50]='Fifty'; words[60]='Sixty'; words[70]='Seventy'; words[80]='Eighty'; words[90]='Ninety';
    let number = amount.toString().split(".")[0], n_length = number.length, words_string = "";
    if (n_length <= 9) {
        let n_array = [0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (let i = 0; i < n_length; i++) n_array[9 - n_length + i] = number.substr(i, 1);
        for (let i = 0, j = 1; i < 9; i++, j++) if ((i == 0 || i == 2 || i == 4 || i == 7) && n_array[i] == 1) { n_array[j] = 10 + parseInt(n_array[j]); n_array[i] = 0; }
        for (let i = 0; i < 9; i++) {
            let value = (i == 0 || i == 2 || i == 4 || i == 7) ? n_array[i] * 10 : n_array[i];
            if (value != 0) words_string += words[value] + " ";
            if ((i == 1 && value != 0) || (i == 0 && value != 0 && n_array[i + 1] == 0)) words_string += "Crore ";
            if ((i == 3 && value != 0) || (i == 2 && value != 0 && n_array[i + 1] == 0)) words_string += "Lakh ";
            if ((i == 5 && value != 0) || (i == 4 && value != 0 && n_array[i + 1] == 0)) words_string += "Thousand ";
            if (i == 6 && value != 0 && (n_array[i + 1] != 0 || n_array[i + 2] != 0)) words_string += "Hundred and ";
            else if (i == 6 && value != 0) words_string += "Hundred ";
        }
    }
    return words_string.trim() || "Zero";
}

function refreshReportsUI() {
    const tbody = document.getElementById('sales-body');
    if(!tbody) return;
    tbody.innerHTML = '';
    let startVal = document.getElementById('filter-start').value, endVal = document.getElementById('filter-end').value, searchVal = document.getElementById('report-search-input').value.toLowerCase().trim();
    let startDate = startVal ? new Date(startVal) : null, endDate = endVal ? new Date(endVal) : null;
    if(startDate) startDate.setHours(0,0,0,0); if(endDate) endDate.setHours(23,59,59,999);
    let filterTotal = 0;

    sales.slice().reverse().forEach((s, revIdx) => {
        let actualIndex = sales.length - 1 - revIdx;
        let includeSale = true;
        let d = s.timestamp ? new Date(s.timestamp) : new Date(s.date);
        if (startDate && d < startDate) includeSale = false;
        if (endDate && d > endDate) includeSale = false;
        if (searchVal !== '' && !(s.invNo && s.invNo.toLowerCase().includes(searchVal)) && !(s.customer && s.customer.toLowerCase().includes(searchVal))) includeSale = false;

        if(includeSale) {
            let invBaseAmt = 0, invTaxAmt = 0;
            s.items.forEach(item => {
                let itemBase = (item.billQty * (item.customRate || item.rate || 0)) - (item.disc || 0);
                if (itemBase < 0) itemBase = 0;
                invBaseAmt += itemBase; invTaxAmt += itemBase * (item.gst / 100);
            });
            if(s.status === 'Completed') filterTotal += s.total;
            let statusBadge = s.status === 'Completed' ? '<span style="color:green; font-weight:bold;">Completed</span>' : '<span style="color:red; font-weight:bold;">Returned</span>';
            let actionsHTML = `<button class="btn btn-primary" style="padding:4px 8px; font-size:11px;" onclick="window.reprintInvoice(${actualIndex})">🖨️ Print</button>`;
            if(s.status === 'Completed') actionsHTML += ` <button class="btn btn-danger" style="padding:4px 8px; font-size:11px;" onclick="window.cancelSale(${actualIndex})">Return</button>`;
            let displayDate = s.timestamp ? new Date(s.timestamp).toLocaleString('en-GB') : s.date;

            tbody.innerHTML += `<tr><td><strong>${s.invNo}</strong></td><td>${displayDate}</td><td>${s.customer}</td><td>${s.payMode || 'Cash'}</td><td>${s.taxMode || 'LOCAL'}</td><td>₹${invBaseAmt.toFixed(2)}</td><td>₹${invTaxAmt.toFixed(2)}</td><td><strong>₹${s.total.toFixed(2)}</strong></td><td>${statusBadge}</td><td>${actionsHTML}</td></tr>`;
        }
    });
    document.getElementById('cum-sales-total').innerText = filterTotal.toFixed(2);
}

window.cancelSale = function(index) {
    let s = sales[index];
    if(confirm(`Are you sure you want to log a return/cancellation for invoice ${s.invNo}?`)) {
        s.status = 'Returned';
        s.items.forEach(item => { let p = products.find(prod => prod.id === item.id); if(p && p.type !== 'service') p.stock += item.billQty; });
        syncData('sales', sales); syncData('products', products);
        logAudit('SALE', `Returned Invoice ${s.invNo}`); refreshInventoryUI(); refreshReportsUI();
    }
};

function clearSalesHistory() {
    if(currentUser.role !== 'ADMIN') return alert("Access Denied.");
    if(confirm("DANGER! Wipe out all cumulative database sales records?")) {
        sales = []; syncData('sales', sales); logAudit('SECURITY', 'Wiped sales ledger records.'); refreshReportsUI();
    }
}

function resetDateFilter() {
    document.getElementById('filter-start').value = ''; document.getElementById('filter-end').value = ''; document.getElementById('report-search-input').value = '';
    refreshReportsUI();
}

function downloadCSV(csvContent, filename) {
    let blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    let link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = filename;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

function exportInventoryCSV() {
    let csv = "Type,Name,HSN/SAC,Unit,Rate,GST %,Stock\n";
    products.forEach(p => { csv += `"${(p.type||'goods').toUpperCase()}","${p.name.replace(/"/g, '""')}","${p.hsn}","${p.unit || (p.type === 'service' ? 'Hr' : 'Nos')}",${p.rate},${p.gst},"${p.type === 'service' ? 'N/A' : p.stock}"\n`; });
    downloadCSV(csv, "Inventory_Report.csv");
}

function exportSalesCSV() {
    let csv = "Invoice No,Date,Customer Name,Pay Mode,Tax Mode,Total Amount,Status,Billed By\n";
    sales.forEach(s => { csv += `"${s.invNo}","${s.timestamp ? new Date(s.timestamp).toLocaleString('en-GB').replace(',', '') : s.date}","${s.customer.replace(/"/g, '""')}","${s.payMode}","${s.taxMode}",${s.total},"${s.status}","${s.billedBy}"\n`; });
    downloadCSV(csv, "Sales_Report.csv");
}

// ==========================================
// PAYTM & UPI Logic
// ==========================================
function toggleUPI() {
    document.getElementById('upi-action-container').style.display = document.getElementById('dash-pay-mode').value === 'UPI' ? 'block' : 'none';
}

function initiateUPI() {
    if(!shopProfile.upiId) return alert("Please configure your Shop UPI ID in the Settings tab first.");
    let total = parseFloat(document.getElementById('cart-total').innerText);
    if(total <= 0) return alert("Cart is empty or total is 0.");
    expectedAmountGlobal = total;
    currentPaytmOrderId = "ORD_" + Date.now();
    
    document.getElementById('qr-amount-display').innerText = total.toFixed(2);
    document.getElementById('qr-upi-id-display').innerText = shopProfile.upiId;
    document.getElementById('upi-qr-image').src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(`upi://pay?pa=${shopProfile.upiId}&pn=${encodeURIComponent(shopProfile.name)}&am=${total}&cu=INR&tn=${currentPaytmOrderId}`)}`;
    
    document.getElementById('upi-status-text').innerHTML = `<span style="display:inline-block; animation: blink 1.5s infinite;">⏳</span> <strong>Listening for Payments...</strong>`;
    document.getElementById('paytm-payments-list').style.display = 'none';
    document.getElementById('qr-code-wrapper').style.display = 'inline-block';
    document.getElementById('upi-modal').style.display = 'flex';

    if (paytmPollTimer) clearInterval(paytmPollTimer);
    paytmPollTimer = setInterval(() => { }, 3000); 
}

function renderPaymentSelectionList(paymentsArray) {
    let listContainer = document.getElementById('paytm-payments-list');
    document.getElementById('upi-status-text').innerHTML = '✅ <strong style="color:green;">Matches found! Select one to approve:</strong>';
    document.getElementById('qr-code-wrapper').style.display = 'none';
    
    listContainer.innerHTML = paymentsArray.map(p => `
        <div class="payment-card" onclick="window.approveWebhookPayment('${p.txnId}', '${p.sender}')">
            <div><div class="payment-card-title">👤 ${p.sender || 'Unknown Sender'}</div><div class="payment-card-sub">🕒 ${p.time} | TXN: ${p.txnId}</div></div>
            <div class="payment-card-amt">₹${parseFloat(p.amount).toFixed(2)}</div>
        </div>`).join('');
    listContainer.style.display = 'block';
}

window.simulatePaytmWebhookPush = function() {
    if (paytmPollTimer) clearInterval(paytmPollTimer);
    renderPaymentSelectionList([
        { txnId: "PTM" + Math.floor(Math.random()*1000000), sender: "Suresh Kumar", amount: expectedAmountGlobal, time: new Date().toLocaleTimeString() },
        { txnId: "PTM" + Math.floor(Math.random()*1000000), sender: "Ramesh Babu", amount: expectedAmountGlobal, time: new Date().toLocaleTimeString() }
    ]);
};

window.approveWebhookPayment = function(txnId, senderName) {
    closeUPIModal(); alert(`✅ Payment from ${senderName} Approved!`);
    document.getElementById('dash-other-ref').value = `Paytm TXN: ${txnId} (${senderName})`;
    processNewSaleAndPrint();
};

function closeUPIModal() {
    if (paytmPollTimer) clearInterval(paytmPollTimer);
    document.getElementById('upi-modal').style.display = 'none';
}

function confirmUPIPayment() {
    closeUPIModal(); alert("✅ Payment Confirmed Manually!"); processNewSaleAndPrint(); 
}

function handleLogoUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            shopProfile.logoBase64 = e.target.result;
            document.getElementById('logo-preview').src = e.target.result;
            document.getElementById('logo-preview').style.display = 'block';
            saveProfile(true);
        };
        reader.readAsDataURL(file);
    }
}
function loadProfileUI() {
    document.getElementById('prof-inv-prefix').value = shopProfile.invPrefix || "INV-";
    document.getElementById('prof-inv-num').value = shopProfile.invNextNum || 1;
    document.getElementById('prof-upi').value = shopProfile.upiId || "";
    document.getElementById('prof-name').value = shopProfile.name;
    document.getElementById('prof-addr').value = shopProfile.addr;
    document.getElementById('prof-gst').value = shopProfile.gst;
    document.getElementById('prof-state').value = shopProfile.state;
    document.getElementById('prof-pan').value = shopProfile.pan || "";
    document.getElementById('prof-contact').value = shopProfile.contact;
    document.getElementById('prof-email').value = shopProfile.email;
    document.getElementById('prof-bank-acname').value = shopProfile.bankAcName || "";
    document.getElementById('prof-bank-name').value = shopProfile.bankName || "";
    document.getElementById('prof-bank-accno').value = shopProfile.bankAccNo || "";
    document.getElementById('prof-bank-ifsc').value = shopProfile.bankIFSC || "";
    document.getElementById('prof-footer-note').value = shopProfile.footerNote || "";
    document.getElementById('prof-print-border').value = shopProfile.printBorder || "0";
    document.getElementById('prof-print-margin').value = shopProfile.printMargin || "10";
    document.getElementById('prof-print-font').value = shopProfile.printFontSize || "11";
    if(shopProfile.logoBase64) {
        document.getElementById('logo-preview').src = shopProfile.logoBase64;
        document.getElementById('logo-preview').style.display = 'block';
    }
}

function attachEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if(btn.id !== 'btn-logout') {
            btn.addEventListener('click', (e) => showSection(e.target.dataset.section));
        }
    });

    // Login/Logout
    document.getElementById('login-pass').addEventListener('keypress', (e) => { if(e.key === 'Enter') attemptLogin() });
    document.getElementById('btn-login').addEventListener('click', attemptLogin);
    document.getElementById('btn-logout').addEventListener('click', logout);

    // Billing
    document.getElementById('dash-pay-mode').addEventListener('change', toggleUPI);
    document.getElementById('btn-initiate-upi').addEventListener('click', initiateUPI);
    document.getElementById('bill-product-name').addEventListener('input', (e) => showAutocomplete(e.target.value));
    document.getElementById('bill-product-name').addEventListener('focus', (e) => showAutocomplete(e.target.value));
    document.getElementById('btn-add-to-cart').addEventListener('click', addToCart);
    document.getElementById('btn-generate-invoice').addEventListener('click', processNewSaleAndPrint);

    // Reports
    document.getElementById('btn-export-sales').addEventListener('click', exportSalesCSV);
    document.getElementById('filter-start').addEventListener('change', refreshReportsUI);
    document.getElementById('filter-end').addEventListener('change', refreshReportsUI);
    document.getElementById('btn-search-reports').addEventListener('click', refreshReportsUI);
    document.getElementById('btn-reset-reports').addEventListener('click', resetDateFilter);
    document.getElementById('btn-clear-sales').addEventListener('click', clearSalesHistory);

    // Inventory
    document.getElementById('btn-export-inventory').addEventListener('click', exportInventoryCSV);
    document.getElementById('inv-type').addEventListener('change', toggleInvStockField);
    document.getElementById('save-product-btn').addEventListener('click', addProduct);

    // Attendance
    document.getElementById('btn-punch-in').addEventListener('click', punchIn);
    document.getElementById('btn-punch-out').addEventListener('click', punchOut);
    document.getElementById('btn-filter-attendance').addEventListener('click', refreshAttendanceUI);
    document.getElementById('btn-reset-attendance').addEventListener('click', () => {
        document.getElementById('att-filter-start').value = '';
        document.getElementById('att-filter-end').value = '';
        refreshAttendanceUI();
    });
    document.getElementById('btn-calc-payroll').addEventListener('click', generatePayroll);

    // Audit
    document.getElementById('btn-clear-audit').addEventListener('click', clearAuditHistory);

    // Profile
    document.getElementById('btn-update-password').addEventListener('click', updateMyPassword);
    document.getElementById('prof-logo').addEventListener('change', handleLogoUpload);
    document.getElementById('btn-save-user').addEventListener('click', saveStaffUser);
    document.getElementById('btn-cancel-edit-user').addEventListener('click', resetUserForm);
    document.getElementById('btn-save-profile').addEventListener('click', () => saveProfile());

    // UPI Modal Actions
    document.getElementById('btn-manual-confirm').addEventListener('click', confirmUPIPayment);
    document.getElementById('btn-close-upi').addEventListener('click', closeUPIModal);
    document.getElementById('btn-simulate-paytm').addEventListener('click', window.simulatePaytmWebhookPush);
}

// Call attachEventListeners once the DOM is fully loaded
document.addEventListener("DOMContentLoaded", attachEventListeners);