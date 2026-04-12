use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq)]
pub struct Condition {
    pub keyword: String,
    pub value: String,
    pub negated: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TextSegment {
    pub text: String,
    pub negated: bool,
}

#[derive(Debug, Default)]
pub struct ParsedQuery {
    pub include: HashMap<String, Vec<String>>,
    pub exclude: HashMap<String, Vec<String>>,
}

#[derive(Debug, Clone)]
pub struct SearchString {
    pub conditions: Vec<Condition>,
    pub text_segments: Vec<TextSegment>,
}

#[derive(PartialEq)]
enum ParserState {
    Reset,
    InText,
    InOperand,
}

#[derive(PartialEq)]
enum QuoteState {
    Reset,
    Single,
    Double,
}

struct QuotePairMap {
    single: HashSet<usize>,
    double: HashSet<usize>,
}

fn get_quote_pair_map(s: &str) -> QuotePairMap {
    let mut single = HashSet::new();
    let mut double = HashSet::new();
    let mut prev_single: Option<usize> = None;
    let mut prev_double: Option<usize> = None;
    let mut prev_char = ' ';

    for (i, c) in s.char_indices() {
        if prev_char != '\\' {
            if c == '"' {
                if let Some(prev) = prev_double {
                    double.insert(prev);
                    double.insert(i);
                    prev_double = None;
                } else {
                    prev_double = Some(i);
                }
            } else if c == '\'' {
                if let Some(prev) = prev_single {
                    single.insert(prev);
                    single.insert(i);
                    prev_single = None;
                } else {
                    prev_single = Some(i);
                }
            }
        }
        prev_char = c;
    }
    QuotePairMap { single, double }
}

impl SearchString {
    pub fn parse(input: &str) -> Self {
        let mut conditions = Vec::new();
        let mut text_segments = Vec::new();

        let mut state = ParserState::Reset;
        let mut quote_state = QuoteState::Reset;
        let mut current_text = String::new();
        let mut current_operand = String::new();
        let mut is_negated = false;
        let mut prev_char = ' ';

        let quote_pair_map = get_quote_pair_map(input);

        let chars: Vec<char> = input.chars().collect();
        let char_indices: Vec<usize> = input.char_indices().map(|(i, _)| i).collect();

        for i in 0..chars.len() {
            let c = chars[i];
            let byte_idx = char_indices[i];

            if c == ' ' {
                if state == ParserState::InOperand {
                    if quote_state != QuoteState::Reset {
                        current_operand.push(c);
                    } else {
                        conditions.push(Condition {
                            keyword: current_text.clone(),
                            value: current_operand.clone(),
                            negated: is_negated,
                        });
                        // Reset
                        state = ParserState::Reset;
                        quote_state = QuoteState::Reset;
                        current_text.clear();
                        current_operand.clear();
                        is_negated = false;
                    }
                } else if state == ParserState::InText {
                    if quote_state != QuoteState::Reset {
                        current_text.push(c);
                    } else {
                        text_segments.push(TextSegment {
                            text: current_text.to_lowercase(),
                            negated: is_negated,
                        });
                        // Reset
                        state = ParserState::Reset;
                        quote_state = QuoteState::Reset;
                        current_text.clear();
                        current_operand.clear();
                        is_negated = false;
                    }
                }
            } else if c == ','
                && state == ParserState::InOperand
                && quote_state == QuoteState::Reset
            {
                conditions.push(Condition {
                    keyword: current_text.clone(),
                    value: current_operand.clone(),
                    negated: is_negated,
                });
                current_operand.clear();
            } else if c == '-' && state == ParserState::Reset {
                is_negated = true;
            } else if c == ':' && quote_state == QuoteState::Reset {
                if state == ParserState::InOperand {
                    current_operand.push(c);
                } else if state == ParserState::InText {
                    state = ParserState::InOperand;
                }
            } else if c == '"' && prev_char != '\\' && quote_state != QuoteState::Single {
                if quote_state == QuoteState::Double {
                    quote_state = QuoteState::Reset;
                } else if quote_pair_map.double.contains(&byte_idx) {
                    quote_state = QuoteState::Double;
                    if state == ParserState::Reset {
                        state = ParserState::InText;
                    }
                } else if state == ParserState::InOperand {
                    current_operand.push(c);
                } else {
                    current_text.push(c);
                }
            } else if c == '\'' && prev_char != '\\' && quote_state != QuoteState::Double {
                if quote_state == QuoteState::Single {
                    quote_state = QuoteState::Reset;
                } else if quote_pair_map.single.contains(&byte_idx) {
                    quote_state = QuoteState::Single;
                    if state == ParserState::Reset {
                        state = ParserState::InText;
                    }
                } else if state == ParserState::InOperand {
                    current_operand.push(c);
                } else {
                    current_text.push(c);
                }
            } else if c != '\\' {
                if state == ParserState::InOperand {
                    current_operand.push(c);
                } else {
                    current_text.push(c);
                    state = ParserState::InText;
                }
            }
            prev_char = c;
        }

        if state == ParserState::InText {
            text_segments.push(TextSegment {
                text: current_text.to_lowercase(),
                negated: is_negated,
            });
        } else if state == ParserState::InOperand {
            conditions.push(Condition {
                keyword: current_text,
                value: current_operand,
                negated: is_negated,
            });
        }

        SearchString {
            conditions,
            text_segments,
        }
    }

    pub fn get_parsed_query(&self) -> ParsedQuery {
        let mut query = ParsedQuery::default();
        for condition in &self.conditions {
            let map = if condition.negated {
                &mut query.exclude
            } else {
                &mut query.include
            };
            map.entry(condition.keyword.clone())
                .or_default()
                .push(condition.value.clone());
        }
        query
    }

    pub fn get_all_text(&self) -> String {
        self.text_segments
            .iter()
            .map(|s| {
                let mut should_quote = false;
                let mut escaped = String::new();
                for c in s.text.chars() {
                    if c == '"' {
                        escaped.push_str("\\\"");
                    } else {
                        if c == ' ' || c == ',' {
                            should_quote = true;
                        }
                        escaped.push(c);
                    }
                }
                let text = if should_quote {
                    format!("\"{}\"", escaped)
                } else {
                    escaped
                };

                if s.negated {
                    format!("-{}", text)
                } else {
                    text
                }
            })
            .collect::<Vec<String>>()
            .join(" ")
    }

    pub fn is_empty(&self) -> bool {
        self.conditions.is_empty() && self.text_segments.is_empty()
    }
}

impl std::fmt::Display for SearchString {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut parts = Vec::new();

        // Group conditions by (negated, keyword)
        let mut condition_groups: HashMap<(bool, String), Vec<String>> = HashMap::new();
        for cond in &self.conditions {
            condition_groups
                .entry((cond.negated, cond.keyword.clone()))
                .or_default()
                .push(cond.value.clone());
        }

        let mut sorted_keys: Vec<&(bool, String)> = condition_groups.keys().collect();
        sorted_keys.sort_by(|a, b| {
            if a.0 != b.0 {
                a.0.cmp(&b.0)
            } else {
                a.1.cmp(&b.1)
            }
        });

        for key in sorted_keys {
            let (negated, keyword) = key;
            let values = condition_groups.get(key).unwrap();
            let safe_values: Vec<String> = values
                .iter()
                .map(|v| {
                    let mut should_quote = false;
                    let mut escaped = String::new();
                    for c in v.chars() {
                        if c == '"' {
                            escaped.push_str("\\\"");
                        } else {
                            if c == ' ' || c == ',' {
                                should_quote = true;
                            }
                            escaped.push(c);
                        }
                    }
                    if should_quote {
                        format!("\"{}\"", escaped)
                    } else {
                        escaped
                    }
                })
                .collect();

            let prefix = if *negated { "-" } else { "" };
            parts.push(format!("{}{}:{}", prefix, keyword, safe_values.join(",")));
        }

        let all_text = self.get_all_text();
        if !all_text.is_empty() {
            parts.push(all_text);
        }

        write!(f, "{}", parts.join(" "))
    }
}

#[cfg(test)]
#[path = "search_string_test.rs"]
mod search_string_test;
