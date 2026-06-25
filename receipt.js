// ============================================================
// RECEIPT & DAILY CLOSING GENERATOR
// ============================================================

const Receipt = {

  // ---- Format KSh currency ----
  formatKSh(amount) {
    return `KSh ${Number(amount || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },

  // ---- Format date ----
  formatDate(iso) {
    const d = new Date(iso || Date.now());
    const day = String(d.getDate()).padStart(2, '0');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
  },

  formatTime(iso) {
    const d = new Date(iso || Date.now());
    return d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: true });
  },

  // ---- Generate receipt HTML (thermal 80mm layout) ----
  generateReceiptHTML(sale, items, settings) {
    const isCredit = sale.payment_method === 'credit';
    const isMpesa = sale.payment_method === 'mpesa';
    const typeLabel = isCredit ? 'CREDIT SALE' : isMpesa ? 'MPESA SALE' : 'CASH SALE';
    const subtotal = items.reduce((s, i) => s + i.line_total, 0);

    const itemsRows = items.map(item => `
      <tr>
        <td colspan="3">
          <div class="receipt-item-name">${item.part_name}</div>
          <div class="receipt-item-detail">${item.sku || ''}</div>
        </td>
      </tr>
      <tr>
        <td>${item.quantity}</td>
        <td class="right">${this.formatKSh(item.unit_price)}</td>
        <td class="right">${this.formatKSh(item.line_total)}</td>
      </tr>
    `).join('');

    const mpesaSection = isMpesa && sale.mpesa_txn_code ? `
      <div class="receipt-mpesa">
        <div class="receipt-mpesa-title">M-PESA PAYMENT</div>
        <div>TXN Code: <span class="receipt-mpesa-txn">${sale.mpesa_txn_code}</span></div>
        <div>Amount: ${this.formatKSh(subtotal)}</div>
      </div>
    ` : '';

    const creditSection = isCredit ? `
      <div class="receipt-credit-note">
        ⚠ CREDIT SALE — Payment Pending<br>
        Amount Due: <strong>${this.formatKSh(subtotal)}</strong>
      </div>
    ` : '';

    return `
      <div class="receipt" id="receipt-printable">
        <div class="receipt-header">
          <div class="receipt-shop-name">${settings.shop_name || 'Sahaja Spareshop'}</div>
          <div class="receipt-shop-sub">Motorcycle Spare Parts</div>
          <div class="receipt-shop-phone">Tel: ${settings.phone || ''}</div>
          <div class="receipt-shop-address">${settings.address || ''}</div>
        </div>

        <div class="receipt-meta">
          <span>Date: ${this.formatDate(sale.created_at)}</span>
          <span>Time: ${this.formatTime(sale.created_at)}</span>
        </div>
        <div class="receipt-meta">
          <span>Receipt No:</span>
          <span><strong>${sale.receipt_number || 'SAH-0001'}</strong></span>
        </div>

        <div class="receipt-type ${sale.payment_method}">${typeLabel}</div>

        <table class="receipt-items">
          <thead>
            <tr>
              <th>ITEM</th>
              <th></th>
              <th class="right">TOTAL</th>
            </tr>
            <tr>
              <th>QTY</th>
              <th class="right">UNIT PRICE</th>
              <th class="right">AMOUNT</th>
            </tr>
          </thead>
          <tbody>${itemsRows}</tbody>
        </table>

        <hr class="receipt-divider">

        <div class="receipt-totals">
          <div class="receipt-total-row">
            <span>Subtotal</span>
            <span>${this.formatKSh(subtotal)}</span>
          </div>
          <div class="receipt-total-row vat-note">
            <span>*All prices inclusive of applicable taxes</span>
            <span></span>
          </div>
          <div class="receipt-total-row grand">
            <span>TOTAL</span>
            <span>${this.formatKSh(subtotal)}</span>
          </div>
        </div>

        ${mpesaSection}
        ${creditSection}

        ${sale.customer_name ? `
          <hr class="receipt-divider">
          <div class="receipt-meta"><span>Customer:</span><span>${sale.customer_name}</span></div>
          ${sale.customer_phone ? `<div class="receipt-meta"><span>Phone:</span><span>${sale.customer_phone}</span></div>` : ''}
          ${sale.customer_location ? `<div class="receipt-meta"><span>Location:</span><span>${sale.customer_location}</span></div>` : ''}
        ` : ''}

        ${sale.operator_name ? `
          <div class="receipt-meta"><span>Operator:</span><span>${sale.operator_name}</span></div>
        ` : ''}

        <div class="receipt-footer">
          <div class="receipt-thank-you">Thank You!</div>
          ${settings.receipt_footer || 'Goods once sold are not returnable.'}
          <br>
          <small>O.E No: ${sale.receipt_number || 'SAH-0001'}</small>
        </div>
      </div>
    `;
  },

  // ---- Generate daily closing report HTML ----
  generateDailyReportHTML(report, settings) {
    const today = new Date();
    const dateStr = this.formatDate(today.toISOString());

    const topPartsRows = (report.top_parts || []).map((p, i) => `
      <li class="daily-report-top-item">
        <span>${i + 1}. ${p.name}</span>
        <span>${p.qty} pcs — ${this.formatKSh(p.revenue)}</span>
      </li>
    `).join('');

    return `
      <div class="daily-report" id="daily-report-printable">
        <div class="daily-report-header">
          <div class="daily-report-title">Daily Closing Report</div>
          <div>${settings.shop_name || 'Sahaja Spareshop'}</div>
          <div class="daily-report-date">${dateStr} | Prepared: ${this.formatTime(today.toISOString())}</div>
        </div>

        <div class="daily-report-section">
          <div class="daily-report-section-title">Revenue Breakdown</div>
          <div class="daily-report-row">
            <span>Cash Sales</span>
            <span>${this.formatKSh(report.total_cash)}</span>
          </div>
          <div class="daily-report-row">
            <span>M-PESA Sales</span>
            <span>${this.formatKSh(report.total_mpesa)}</span>
          </div>
          <div class="daily-report-row">
            <span>Credit Sales</span>
            <span>${this.formatKSh(report.total_credit)}</span>
          </div>
          <div class="daily-report-row total">
            <span>TOTAL REVENUE</span>
            <span>${this.formatKSh(report.total_revenue)}</span>
          </div>
        </div>

        <div class="daily-report-section">
          <div class="daily-report-section-title">Transactions</div>
          <div class="daily-report-row">
            <span>Total Transactions</span>
            <span>${report.transaction_count}</span>
          </div>
          <div class="daily-report-row">
            <span>Items Sold</span>
            <span>${report.items_sold} pcs</span>
          </div>
          <div class="daily-report-row">
            <span>Average Sale</span>
            <span>${this.formatKSh(report.transaction_count > 0 ? report.total_revenue / report.transaction_count : 0)}</span>
          </div>
        </div>

        ${topPartsRows ? `
          <div class="daily-report-section">
            <div class="daily-report-section-title">Top Items Today</div>
            <ul class="daily-report-top-list">${topPartsRows}</ul>
          </div>
        ` : ''}

        <div class="daily-report-footer">
          ${settings.shop_name || 'Sahaja Spareshop'} — Internal Report<br>
          ${settings.phone || ''} | ${settings.address || ''}<br>
          <small>Generated by Sahaja Shop Tool</small>
        </div>
      </div>
    `;
  },

  // ---- Print ----
  print(elementId) {
    window.print();
  }
};

window.Receipt = Receipt;
