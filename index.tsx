/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from "@google/genai";
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";

const App = () => {
  const [expenses, setExpenses] = useState([]);
  const [image, setImage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [userId, setUserId] = useState(null);
  const [sortOrder, setSortOrder] = useState('desc');
  const [editingId, setEditingId] = useState(null);
  const [editedExpense, setEditedExpense] = useState(null);

  useEffect(() => {
    let currentUserId = localStorage.getItem("receiptify_userId");
    if (!currentUserId) {
      currentUserId = `user_${crypto.randomUUID()}`;
      localStorage.setItem("receiptify_userId", currentUserId);
    }
    setUserId(currentUserId);
  }, []);

  useEffect(() => {
    if (!userId) return;
    try {
      const storageKey = `expenses_${userId}`;
      const storedExpenses = localStorage.getItem(storageKey);
      if (storedExpenses) {
        setExpenses(JSON.parse(storedExpenses));
      }
    } catch (e) {
      console.error("Failed to load expenses from local storage", e);
      setError("Could not load saved expenses.");
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    try {
      const storageKey = `expenses_${userId}`;
      localStorage.setItem(storageKey, JSON.stringify(expenses));
    } catch (e) {
      console.error("Failed to save expenses to local storage", e);
      setError("Could not save new expense.");
    }
  }, [expenses, userId]);

  const fileToGenerativePart = async (file) => {
    const base64EncodedDataPromise = new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onloadend = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result.split(",")[1]);
        } else {
          reject(new Error("Failed to read file data."));
        }
      };
      reader.readAsDataURL(file);
    });
    return {
      inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
    };
  };

  const getCurrencySymbol = (currency) => {
    switch (currency?.toUpperCase()) {
      case 'KRW':
      case 'WON':
        return '₩';
      case 'USD':
        return '$';
      case 'EUR':
        return '€';
      default:
        return '₩';
    }
  };

  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setError(null);
    setImage(URL.createObjectURL(file));
    setIsLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const imagePart = await fileToGenerativePart(file);
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            parts: [
              imagePart,
              {
                text: "You are an expert receipt analyst with advanced image processing capabilities. Before extracting data, mentally preprocess this image: correct for any crumples, folds, or perspective distortions to view it as a flat document. Enhance text clarity and contrast, especially for blurry or faded characters. After this enhancement, analyze the preprocessed receipt image and extract the merchant name, date of purchase, the total amount, the currency (e.g., KRW, USD), and a list of all line items. For each line item, provide its original description, its English translation, the quantity, the unit price, and the total price for the line item. Ensure the date is in YYYY-MM-DD format.",
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              merchant: { type: Type.STRING },
              date: { type: Type.STRING },
              total: { type: Type.NUMBER },
              currency: { type: Type.STRING, description: "The currency of the total amount, e.g., USD, KRW" },
              items: {
                type: Type.ARRAY,
                description: "A list of purchased items.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    description: { type: Type.STRING },
                    description_en: { type: Type.STRING, description: "English translation of the item description." },
                    quantity: { type: Type.NUMBER, description: "Quantity of the item, defaults to 1 if not present." },
                    unit_price: { type: Type.NUMBER, description: "Price per single unit of the item." },
                    price: { type: Type.NUMBER, description: "Total price for this line item." },
                  },
                  required: ["description", "description_en", "price"],
                }
              }
            },
            required: ["merchant", "date", "total"],
          },
        },
      });

      const parsedData = JSON.parse(response.text);
      const processedData = {
          ...parsedData,
          items: (parsedData.items || []).map(item => ({
              description: item.description || '',
              description_en: item.description_en || '',
              quantity: item.quantity || 1,
              unit_price: item.unit_price || item.price || 0,
              price: item.price || 0,
          }))
      };

      setExpenses((prevExpenses) => [
        { ...processedData, id: Date.now() },
        ...prevExpenses,
      ]);
    } catch (err) {
      console.error(err);
      setError("Failed to process receipt. Please try another image.");
    } finally {
      setIsLoading(false);
      setImage(null);
      e.target.value = null;
    }
  };

  const toggleSortOrder = () => {
    setSortOrder(prevOrder => (prevOrder === 'desc' ? 'asc' : 'desc'));
  };

  const handleEdit = (expense) => {
    setEditingId(expense.id);
    setEditedExpense(JSON.parse(JSON.stringify(expense)));
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditedExpense(null);
  };

  const handleSaveEdit = () => {
    setExpenses(expenses.map(exp => exp.id === editingId ? editedExpense : exp));
    handleCancelEdit();
  };

  const handleDelete = (id) => {
    if (window.confirm("Are you sure you want to delete this expense?")) {
      setExpenses(prevExpenses => prevExpenses.filter(exp => exp.id !== id));
    }
  };

  const handleFieldChange = (e) => {
    const { name, value } = e.target;
    setEditedExpense(prev => ({ ...prev, [name]: name === 'total' ? parseFloat(value) || 0 : value }));
  };

  const handleItemChange = (index, e) => {
    const { name, value } = e.target;
    const newItems = [...editedExpense.items];
    const currentItem = { ...newItems[index] };
    
    if (['quantity', 'unit_price', 'price'].includes(name)) {
        currentItem[name] = parseFloat(value) || 0;
    } else {
        currentItem[name] = value;
    }
    
    newItems[index] = currentItem;
    setEditedExpense(prev => ({ ...prev, items: newItems }));
  };
  
  const handleAddItem = () => {
    const newItems = [...editedExpense.items, { description: '', description_en: '', quantity: 1, unit_price: 0, price: 0 }];
    setEditedExpense(prev => ({ ...prev, items: newItems }));
  };

  const handleRemoveItem = (index) => {
    const newItems = editedExpense.items.filter((_, i) => i !== index);
    setEditedExpense(prev => ({ ...prev, items: newItems }));
  };

  const sortedExpenses = [...expenses].sort((a, b) => {
    const dateA = a.date ? new Date(a.date) : new Date(0);
    const dateB = b.date ? new Date(b.date) : new Date(0);
    if (sortOrder === 'desc') {
      return dateB.getTime() - dateA.getTime();
    } else {
      return dateA.getTime() - dateB.getTime();
    }
  });

  const totalExpenses = expenses.reduce((sum, expense) => sum + (expense.total || 0), 0);

  const renderExpenseItem = (expense) => (
     <div className="expense-item-content">
        <div className="expense-header">
            <div className="expense-details">
            <span className="expense-merchant">{expense.merchant || "N/A"}</span>
            <span className="expense-date">{expense.date || "N/A"}</span>
            </div>
            <span className="expense-total">
            {getCurrencySymbol(expense.currency)}
            {(expense.total || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </span>
        </div>
        {expense.items && expense.items.length > 0 && (
            <div className="line-items-container">
                <div className="line-items-header">
                    <span className="header-item-desc">Item</span>
                    <span className="header-item-qty">Qty</span>
                    <span className="header-item-unit">Unit Price</span>
                    <span className="header-item-price">Amount</span>
                </div>
                <ul className="expense-line-items">
                {expense.items.map((item, index) => (
                    <li key={index} className="line-item">
                    <div className="line-item-description">
                        <span className="item-description-original">{item.description}</span>
                        <span className="item-description-en">{item.description_en}</span>
                    </div>
                    <span className="line-item-qty">{item.quantity || 1}</span>
                    <span className="line-item-unit-price">
                        {getCurrencySymbol(expense.currency)}
                        {(item.unit_price || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </span>
                    <span className="line-item-price">
                        {getCurrencySymbol(expense.currency)}
                        {(item.price || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </span>
                    </li>
                ))}
                </ul>
            </div>
        )}
        <div className="expense-actions">
            <button onClick={() => handleEdit(expense)} className="edit-btn">Edit</button>
            <button onClick={() => handleDelete(expense.id)} className="delete-btn">Delete</button>
        </div>
    </div>
  );

  const renderEditForm = () => (
    <div className="expense-edit-form">
        <div className="form-group">
            <label htmlFor="merchant">Merchant</label>
            <input type="text" id="merchant" name="merchant" value={editedExpense.merchant} onChange={handleFieldChange} />
        </div>
        <div className="form-group">
            <label htmlFor="date">Date</label>
            <input type="date" id="date" name="date" value={editedExpense.date} onChange={handleFieldChange} />
        </div>
         <div className="form-group">
            <label htmlFor="total">Total</label>
            <input type="number" id="total" name="total" value={editedExpense.total} onChange={handleFieldChange} />
        </div>

        <h4 className="edit-items-header">Items</h4>
        <div className="edit-line-items-header">
            <span>Item (Original)</span>
            <span>Item (English)</span>
            <span>Qty</span>
            <span>Unit Price</span>
            <span>Amount</span>
        </div>
        <ul className="edit-line-items">
        {(editedExpense.items || []).map((item, index) => (
            <li key={index} className="edit-line-item">
                <input type="text" name="description" placeholder="Item (Original)" value={item.description} onChange={(e) => handleItemChange(index, e)} />
                <input type="text" name="description_en" placeholder="Item (English)" value={item.description_en} onChange={(e) => handleItemChange(index, e)} />
                <input type="number" name="quantity" placeholder="Qty" value={item.quantity} onChange={(e) => handleItemChange(index, e)} className="item-qty-input" />
                <input type="number" name="unit_price" placeholder="Unit Price" value={item.unit_price} onChange={(e) => handleItemChange(index, e)} className="item-unit-price-input" />
                <input type="number" name="price" placeholder="Amount" value={item.price} onChange={(e) => handleItemChange(index, e)} className="item-price-input" />
                <button onClick={() => handleRemoveItem(index)} className="remove-item-btn">&times;</button>
            </li>
        ))}
        </ul>
        <button onClick={handleAddItem} className="add-item-btn">Add Item</button>

        <div className="form-actions">
            <button onClick={handleSaveEdit} className="save-btn">Save</button>
            <button onClick={handleCancelEdit} className="cancel-btn">Cancel</button>
        </div>
    </div>
  );

  return (
    <>
      <header className="app-header">
        <h1>Receiptify</h1>
        <p>Your Smart Expense Tracker</p>
      </header>

      <main className="main-content">
        <aside className="uploader-section">
          <h3>New Expense</h3>
          <p>Scan a receipt to get started.</p>
          <label htmlFor="receipt-upload" className={`upload-btn ${isLoading ? 'disabled' : ''}`}>
            {isLoading ? "Scanning..." : "Scan New Receipt"}
          </label>
          <input
            id="receipt-upload"
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            disabled={isLoading}
            style={{ display: "none" }}
          />
          {isLoading && (
            <div className="status-message loading">
                <div className="loader"></div>
                Analyzing receipt...
            </div>
          )}
          {error && <p className="status-message error">{error}</p>}
          {image && <img src={image} alt="Receipt Preview" className="receipt-preview" />}
        </aside>

        <section className="expenses-section">
          <div className="expenses-header-controls">
            <h2>My Expenses</h2>
            {expenses.length > 0 && (
              <button onClick={toggleSortOrder} className="sort-btn" aria-label={`Sort by date, current order: ${sortOrder === 'desc' ? 'newest first' : 'oldest first'}`}>
                {sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}
              </button>
            )}
          </div>
          <div className="total-expenses">
            <h3>Total Amount</h3>
            <span>
              ₩{totalExpenses.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </span>
          </div>
          {expenses.length > 0 ? (
            <ul className="expense-list">
              {sortedExpenses.map((expense) => (
                <li key={expense.id} className="expense-item" aria-live="polite">
                  {editingId === expense.id ? renderEditForm() : renderExpenseItem(expense)}
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              <p>Your scanned expenses will appear here.</p>
            </div>
          )}
        </section>
      </main>
    </>
  );
};

const root = createRoot(document.getElementById("root"));
root.render(<App />);